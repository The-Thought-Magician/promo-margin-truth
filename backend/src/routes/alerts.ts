import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  promo_alerts,
  promos,
  promo_pnl,
  cannibalization_results,
  workspaces,
  notifications,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

function severityFor(dollarsDestroyedCents: number, marginPct: number): 'low' | 'medium' | 'high' {
  // dollarsDestroyed is stored as a positive magnitude of destroyed contribution
  if (dollarsDestroyedCents >= 100_000 || marginPct <= -0.1) return 'high'
  if (dollarsDestroyedCents >= 20_000 || marginPct < 0) return 'medium'
  return 'low'
}

// Public: list alerts, optional ?status filter, scoped to user when known
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? getUserId(c)
  const status = c.req.query('status')
  const conds = []
  if (userId) conds.push(eq(promo_alerts.user_id, userId))
  if (status) conds.push(eq(promo_alerts.status, status))
  const rows = await db
    .select()
    .from(promo_alerts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(promo_alerts.dollars_destroyed_cents), desc(promo_alerts.created_at))
  return c.json(rows)
})

// Auth: scan — recompute alerts from latest P&L + cannibalization adjustments,
// flag money-losing promos, detect recurring (same campaign_tag offending repeatedly).
router.post('/scan', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  const minContribution = ws?.flag_min_contribution_cents ?? 0
  const minMarginPct = ws?.flag_min_margin_pct ?? 0

  const userPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
  const promoById = new Map(userPromos.map((p) => [p.id, p]))

  const pnlRows = await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))
  const pnlByPromo = new Map(pnlRows.map((p) => [p.promo_id, p]))

  const cannRows = await db
    .select()
    .from(cannibalization_results)
    .where(eq(cannibalization_results.user_id, userId))
  const cannByPromo = new Map(cannRows.map((r) => [r.promo_id, r]))

  // Count offenses by campaign_tag to detect recurring money-losers.
  const offenseByTag = new Map<string, number>()
  for (const pnl of pnlRows) {
    const promo = promoById.get(pnl.promo_id)
    if (!promo) continue
    const cann = cannByPromo.get(pnl.promo_id)
    const adjustedContribution = pnl.contribution_cents - (cann?.dollar_adjustment_cents ?? 0)
    const losing = adjustedContribution < minContribution || pnl.realized_margin_pct < minMarginPct
    if (losing && promo.campaign_tag) {
      offenseByTag.set(promo.campaign_tag, (offenseByTag.get(promo.campaign_tag) ?? 0) + 1)
    }
  }

  // Clear existing open/acknowledged auto-generated alerts so a rescan reflects
  // the latest data (preserve snoozed/resolved history).
  const existingAlerts = await db
    .select()
    .from(promo_alerts)
    .where(eq(promo_alerts.user_id, userId))
  const keepStatuses = new Set(['snoozed', 'resolved'])
  for (const a of existingAlerts) {
    if (!keepStatuses.has(a.status)) {
      await db.delete(promo_alerts).where(eq(promo_alerts.id, a.id))
    }
  }

  const created: Array<typeof promo_alerts.$inferSelect> = []

  for (const pnl of pnlRows) {
    const promo = promoById.get(pnl.promo_id)
    if (!promo) continue
    const cann = cannByPromo.get(pnl.promo_id)
    const cannAdj = cann?.dollar_adjustment_cents ?? 0
    const adjustedContribution = pnl.contribution_cents - cannAdj
    const losing =
      adjustedContribution < minContribution || pnl.realized_margin_pct < minMarginPct
    if (!losing) continue

    // dollars destroyed = magnitude of negative contribution (after cannibalization
    // adjustment); for thin-but-positive flags use the shortfall vs threshold.
    const dollarsDestroyed =
      adjustedContribution < 0
        ? Math.abs(adjustedContribution)
        : Math.max(0, minContribution - adjustedContribution)

    const isRecurring =
      !!promo.campaign_tag && (offenseByTag.get(promo.campaign_tag) ?? 0) >= 2

    const severity = severityFor(dollarsDestroyed, pnl.realized_margin_pct)

    let recommendation = 'review'
    if (adjustedContribution < 0) {
      recommendation =
        promo.discount_depth_pct >= 30
          ? 'kill_or_reduce_depth'
          : 'kill_promo'
    } else if (isRecurring) {
      recommendation = 'stop_recurring_promo'
    } else {
      recommendation = 'reduce_discount_depth'
    }

    // Skip duplicate of an existing preserved (snoozed/resolved) alert for the same promo.
    const preserved = existingAlerts.find(
      (a) => a.promo_id === pnl.promo_id && keepStatuses.has(a.status),
    )
    if (preserved) continue

    const [row] = await db
      .insert(promo_alerts)
      .values({
        user_id: userId,
        promo_id: pnl.promo_id,
        severity,
        dollars_destroyed_cents: dollarsDestroyed,
        recommendation,
        is_recurring: isRecurring,
        status: 'open',
        detail: {
          promo_name: promo.name,
          campaign_tag: promo.campaign_tag,
          contribution_cents: pnl.contribution_cents,
          cannibalization_adjustment_cents: cannAdj,
          adjusted_contribution_cents: adjustedContribution,
          realized_margin_pct: pnl.realized_margin_pct,
          discount_depth_pct: promo.discount_depth_pct,
          threshold_contribution_cents: minContribution,
          threshold_margin_pct: minMarginPct,
        },
      })
      .returning()
    created.push(row)

    await db.insert(notifications).values({
      user_id: userId,
      kind: 'alert',
      title: `Money-losing promo: ${promo.name}`,
      body: `Destroyed ${(dollarsDestroyed / 100).toFixed(2)} in contribution. Recommendation: ${recommendation}.`,
    })
  }

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'scan',
    entity: 'alerts',
    entity_id: null,
    detail: { created: created.length },
  })

  return c.json({ created: created.length, alerts: created }, 201)
})

async function setStatus(c: any, status: string) {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(promo_alerts).where(eq(promo_alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(promo_alerts)
    .set({ status })
    .where(eq(promo_alerts.id, id))
    .returning()
  await db.insert(activity_log).values({
    user_id: userId,
    action: status,
    entity: 'alert',
    entity_id: id,
    detail: {},
  })
  return c.json(updated)
}

router.post('/:id/ack', authMiddleware, (c) => setStatus(c, 'acknowledged'))
router.post('/:id/snooze', authMiddleware, (c) => setStatus(c, 'snoozed'))
router.post('/:id/resolve', authMiddleware, (c) => setStatus(c, 'resolved'))

export default router
