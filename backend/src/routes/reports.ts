import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reports,
  promos,
  promo_pnl,
  incrementality_results,
  cannibalization_results,
  customer_splits,
  promo_alerts,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Payload regeneration — rebuild a report's payload from the latest analysis
// rows. Scope drives what is gathered:
//   - scope 'promo'  : single promo P&L + incrementality + cannibalization +
//                      customer split + adjusted contribution
//   - scope 'period' : every promo whose window overlaps [period_start, end]
// ---------------------------------------------------------------------------

async function buildPromoPayload(userId: string, promoId: string) {
  const [promo] = await db
    .select()
    .from(promos)
    .where(and(eq(promos.id, promoId), eq(promos.user_id, userId)))
  if (!promo) return null

  const [pnl] = await db
    .select()
    .from(promo_pnl)
    .where(eq(promo_pnl.promo_id, promoId))
  const incrementality = await db
    .select()
    .from(incrementality_results)
    .where(eq(incrementality_results.promo_id, promoId))
  const [cannibalization] = await db
    .select()
    .from(cannibalization_results)
    .where(eq(cannibalization_results.promo_id, promoId))
  const [split] = await db
    .select()
    .from(customer_splits)
    .where(eq(customer_splits.promo_id, promoId))

  const contribution = pnl?.contribution_cents ?? 0
  const cannibalAdj = cannibalization?.dollar_adjustment_cents ?? 0
  const adjustedContribution = contribution - cannibalAdj

  return {
    promo: {
      id: promo.id,
      name: promo.name,
      promo_type: promo.promo_type,
      discount_depth_pct: promo.discount_depth_pct,
      start_at: promo.start_at,
      end_at: promo.end_at,
      status: promo.status,
    },
    pnl: pnl ?? null,
    incrementality,
    cannibalization: cannibalization ?? null,
    customer_split: split ?? null,
    adjusted_contribution_cents: adjustedContribution,
    headline:
      adjustedContribution < 0
        ? `This promo destroyed ${Math.abs(adjustedContribution)} cents of contribution after adjustments.`
        : `This promo generated ${adjustedContribution} cents of adjusted contribution.`,
  }
}

async function buildPeriodPayload(
  userId: string,
  periodStart: Date | null,
  periodEnd: Date | null,
) {
  const allPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
  const startMs = periodStart ? periodStart.getTime() : -Infinity
  const endMs = periodEnd ? periodEnd.getTime() : Infinity

  const inWindow = allPromos.filter((p) => {
    const s = new Date(p.start_at).getTime()
    const e = new Date(p.end_at).getTime()
    // overlap test
    return e >= startMs && s <= endMs
  })

  const rows: Array<{
    promo_id: string
    name: string
    contribution_cents: number
    adjusted_contribution_cents: number
    realized_margin_pct: number
  }> = []
  let totalContribution = 0
  let totalAdjusted = 0
  let dollarsDestroyed = 0

  for (const p of inWindow) {
    const [pnl] = await db.select().from(promo_pnl).where(eq(promo_pnl.promo_id, p.id))
    const [cannibal] = await db
      .select()
      .from(cannibalization_results)
      .where(eq(cannibalization_results.promo_id, p.id))
    const contribution = pnl?.contribution_cents ?? 0
    const adjusted = contribution - (cannibal?.dollar_adjustment_cents ?? 0)
    totalContribution += contribution
    totalAdjusted += adjusted
    if (adjusted < 0) dollarsDestroyed += Math.abs(adjusted)
    rows.push({
      promo_id: p.id,
      name: p.name,
      contribution_cents: contribution,
      adjusted_contribution_cents: adjusted,
      realized_margin_pct: pnl?.realized_margin_pct ?? 0,
    })
  }

  rows.sort((a, b) => a.adjusted_contribution_cents - b.adjusted_contribution_cents)

  return {
    period_start: periodStart,
    period_end: periodEnd,
    promo_count: inWindow.length,
    total_contribution_cents: totalContribution,
    total_adjusted_contribution_cents: totalAdjusted,
    dollars_destroyed_cents: dollarsDestroyed,
    losers: rows.filter((r) => r.adjusted_contribution_cents < 0),
    winners: rows.filter((r) => r.adjusted_contribution_cents >= 0).slice(0, 10),
    rows,
  }
}

async function regeneratePayload(userId: string, report: typeof reports.$inferSelect) {
  if (report.scope === 'promo' && report.scope_id) {
    return await buildPromoPayload(userId, report.scope_id)
  }
  // period (or anything else) → period teardown across the report's window
  return await buildPeriodPayload(userId, report.period_start, report.period_end)
}

// ---------------------------------------------------------------------------
// GET / — Public — list reports (optionally for a user)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(reports)
        .where(eq(reports.user_id, userId))
        .orderBy(desc(reports.created_at))
    : await db.select().from(reports).orderBy(desc(reports.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — Public — report detail
// ---------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!report) return c.json({ error: 'Not found' }, 404)
  return c.json(report)
})

// ---------------------------------------------------------------------------
// POST /:id/rerun — Auth — regenerate the report payload against latest data
// ---------------------------------------------------------------------------
router.post('/:id/rerun', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [report] = await db.select().from(reports).where(eq(reports.id, id))
  if (!report) return c.json({ error: 'Not found' }, 404)
  if (report.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const payload = await regeneratePayload(userId, report)
  if (payload === null) return c.json({ error: 'Report scope no longer resolvable' }, 404)

  const [updated] = await db
    .update(reports)
    .set({ payload: payload as Record<string, unknown> })
    .where(eq(reports.id, id))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'rerun',
    entity: 'report',
    entity_id: id,
    detail: { kind: report.kind, scope: report.scope },
  })

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — Auth — delete report
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [report] = await db.select().from(reports).where(eq(reports.id, id))
  if (!report) return c.json({ error: 'Not found' }, 404)
  if (report.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(reports).where(eq(reports.id, id))

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'report',
    entity_id: id,
    detail: { title: report.title },
  })

  return c.json({ success: true })
})

export default router
