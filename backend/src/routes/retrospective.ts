import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reports,
  promos,
  promo_pnl,
  incrementality_results,
  cannibalization_results,
  customer_splits,
  promo_alerts,
  channel_stats,
  activity_log,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Build a CFO-ready payload for a single promo: P&L waterfall, incrementality,
// cannibalization, customer split, channel mix, and a recoverable-dollars verdict.
// ---------------------------------------------------------------------------

async function buildPromoPayload(userId: string, promoId: string) {
  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return null

  const [pnl] = await db.select().from(promo_pnl).where(eq(promo_pnl.promo_id, promoId))
  const incr = await db
    .select()
    .from(incrementality_results)
    .where(eq(incrementality_results.promo_id, promoId))
  const [cann] = await db
    .select()
    .from(cannibalization_results)
    .where(eq(cannibalization_results.promo_id, promoId))
  const [split] = await db
    .select()
    .from(customer_splits)
    .where(eq(customer_splits.promo_id, promoId))
  const channels = await db
    .select()
    .from(channel_stats)
    .where(eq(channel_stats.promo_id, promoId))

  const contribution = pnl?.contribution_cents ?? 0
  const cannAdj = cann?.dollar_adjustment_cents ?? 0
  const trueContribution = contribution - cannAdj
  const existingSubsidy = split?.existing_subsidy_cents ?? 0

  // Recoverable dollars: the contribution that would be saved by killing or
  // de-risking the promo (negative true contribution + subsidy to already-loyal
  // existing customers that did not need the discount).
  const recoverable =
    (trueContribution < 0 ? Math.abs(trueContribution) : 0) + Math.max(0, existingSubsidy)

  const verdict =
    trueContribution < 0
      ? 'destroyed_value'
      : pnl && pnl.realized_margin_pct < pnl.list_margin_pct * 0.5
        ? 'thin_margin'
        : 'profitable'

  return {
    promo: {
      id: promo.id,
      name: promo.name,
      promo_type: promo.promo_type,
      discount_depth_pct: promo.discount_depth_pct,
      start_at: promo.start_at,
      end_at: promo.end_at,
      campaign_tag: promo.campaign_tag,
    },
    pnl: pnl ?? null,
    waterfall: pnl?.waterfall ?? [],
    incrementality: incr,
    cannibalization: cann ?? null,
    customer_split: split ?? null,
    channels,
    summary: {
      reported_contribution_cents: contribution,
      cannibalization_adjustment_cents: cannAdj,
      true_contribution_cents: trueContribution,
      existing_subsidy_cents: existingSubsidy,
      recoverable_cents: recoverable,
      realized_margin_pct: pnl?.realized_margin_pct ?? 0,
      list_margin_pct: pnl?.list_margin_pct ?? 0,
      verdict,
    },
  }
}

// Auth: generate per-promo retrospective report, saving to reports
router.post('/promo/:promoId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const promoId = c.req.param('promoId')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const payload = await buildPromoPayload(userId, promoId)
  if (!payload) return c.json({ error: 'Promo not found' }, 404)

  const [report] = await db
    .insert(reports)
    .values({
      user_id: userId,
      kind: 'retrospective',
      scope: 'promo',
      scope_id: promoId,
      title: `Retrospective — ${promo.name}`,
      period_start: promo.start_at,
      period_end: promo.end_at,
      payload,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'generate',
    entity: 'report',
    entity_id: report.id,
    detail: { kind: 'retrospective', promo_id: promoId },
  })

  return c.json(report, 201)
})

const periodSchema = z.object({
  start: z.string(),
  end: z.string(),
  title: z.string().min(1).optional(),
})

async function buildPeriodPayload(userId: string, start: Date, end: Date) {
  // Promos whose window overlaps the period.
  const allPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
  const inPeriod = allPromos.filter((p) => p.start_at <= end && p.end_at >= start)
  const promoIds = new Set(inPeriod.map((p) => p.id))

  const pnlRows = (await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))).filter(
    (r) => promoIds.has(r.promo_id),
  )
  const cannRows = (
    await db
      .select()
      .from(cannibalization_results)
      .where(eq(cannibalization_results.user_id, userId))
  ).filter((r) => promoIds.has(r.promo_id))
  const cannByPromo = new Map(cannRows.map((r) => [r.promo_id, r]))
  const promoById = new Map(inPeriod.map((p) => [p.id, p]))

  let totalGross = 0
  let totalDiscount = 0
  let totalNet = 0
  let totalCogs = 0
  let totalFee = 0
  let totalContribution = 0
  let totalTrueContribution = 0
  let totalRecoverable = 0
  let totalUnits = 0

  const perPromo = pnlRows.map((pnl) => {
    const cannAdj = cannByPromo.get(pnl.promo_id)?.dollar_adjustment_cents ?? 0
    const trueContribution = pnl.contribution_cents - cannAdj
    const recoverable = trueContribution < 0 ? Math.abs(trueContribution) : 0
    totalGross += pnl.gross_revenue_cents
    totalDiscount += pnl.discount_cents
    totalNet += pnl.net_revenue_cents
    totalCogs += pnl.cogs_cents
    totalFee += pnl.platform_fee_cents
    totalContribution += pnl.contribution_cents
    totalTrueContribution += trueContribution
    totalRecoverable += recoverable
    totalUnits += pnl.units
    const promo = promoById.get(pnl.promo_id)
    return {
      promo_id: pnl.promo_id,
      name: promo?.name ?? pnl.promo_id,
      campaign_tag: promo?.campaign_tag ?? null,
      discount_depth_pct: promo?.discount_depth_pct ?? 0,
      contribution_cents: pnl.contribution_cents,
      cannibalization_adjustment_cents: cannAdj,
      true_contribution_cents: trueContribution,
      recoverable_cents: recoverable,
      realized_margin_pct: pnl.realized_margin_pct,
      units: pnl.units,
    }
  })

  perPromo.sort((a, b) => a.true_contribution_cents - b.true_contribution_cents)
  const losers = perPromo.filter((p) => p.true_contribution_cents < 0)
  const winners = [...perPromo]
    .filter((p) => p.true_contribution_cents > 0)
    .sort((a, b) => b.true_contribution_cents - a.true_contribution_cents)

  const blendedMargin = totalNet > 0 ? totalTrueContribution / totalNet : 0

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    promo_count: inPeriod.length,
    analyzed_count: pnlRows.length,
    totals: {
      gross_revenue_cents: totalGross,
      discount_cents: totalDiscount,
      net_revenue_cents: totalNet,
      cogs_cents: totalCogs,
      platform_fee_cents: totalFee,
      reported_contribution_cents: totalContribution,
      true_contribution_cents: totalTrueContribution,
      recoverable_cents: totalRecoverable,
      units: totalUnits,
      blended_true_margin_pct: blendedMargin,
    },
    losers,
    winners: winners.slice(0, 10),
    per_promo: perPromo,
  }
}

// Auth: generate period teardown report across promos
router.post('/period', authMiddleware, zValidator('json', periodSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const start = new Date(body.start)
  const end = new Date(body.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Invalid period range' }, 400)
  }

  const payload = await buildPeriodPayload(userId, start, end)

  const [report] = await db
    .insert(reports)
    .values({
      user_id: userId,
      kind: 'period_teardown',
      scope: 'period',
      scope_id: null,
      title:
        body.title ??
        `Period teardown ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
      period_start: start,
      period_end: end,
      payload,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'generate',
    entity: 'report',
    entity_id: report.id,
    detail: { kind: 'period_teardown', start: body.start, end: body.end },
  })

  return c.json(report, 201)
})

// Public: dollar-recovery summary — recoverable contribution from open alerts
router.get('/recovery', async (c) => {
  const userId = c.req.query('user_id') ?? getUserId(c)
  if (!userId) return c.json({ recoverable_cents: 0, by_promo: [] })

  const openAlerts = await db
    .select()
    .from(promo_alerts)
    .where(and(eq(promo_alerts.user_id, userId), eq(promo_alerts.status, 'open')))

  const acknowledgedAlerts = await db
    .select()
    .from(promo_alerts)
    .where(and(eq(promo_alerts.user_id, userId), eq(promo_alerts.status, 'acknowledged')))

  const actionable = [...openAlerts, ...acknowledgedAlerts]

  const promoIds = [...new Set(actionable.map((a) => a.promo_id))]
  const promoNames = new Map<string, string>()
  for (const pid of promoIds) {
    const [p] = await db.select().from(promos).where(eq(promos.id, pid))
    if (p) promoNames.set(pid, p.name)
  }

  let recoverable = 0
  const byPromoMap = new Map<
    string,
    { promo_id: string; name: string; recoverable_cents: number; severity: string; is_recurring: boolean }
  >()
  for (const a of actionable) {
    recoverable += a.dollars_destroyed_cents
    const existing = byPromoMap.get(a.promo_id)
    if (existing) {
      existing.recoverable_cents += a.dollars_destroyed_cents
      if (a.is_recurring) existing.is_recurring = true
    } else {
      byPromoMap.set(a.promo_id, {
        promo_id: a.promo_id,
        name: promoNames.get(a.promo_id) ?? a.promo_id,
        recoverable_cents: a.dollars_destroyed_cents,
        severity: a.severity,
        is_recurring: a.is_recurring,
      })
    }
  }

  const by_promo = Array.from(byPromoMap.values()).sort(
    (x, y) => y.recoverable_cents - x.recoverable_cents,
  )

  return c.json({ recoverable_cents: recoverable, by_promo })
})

// Auth: SSE progress stream for building a period teardown (live per-promo
// progress, then the final payload). Not part of the 1:1 api map; a richer UX
// channel for long teardowns.
router.get('/period/stream', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const start = new Date(c.req.query('start') ?? '')
  const end = new Date(c.req.query('end') ?? '')

  return streamSSE(c, async (stream) => {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Invalid period range' }) })
      return
    }

    const allPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
    const inPeriod = allPromos.filter((p) => p.start_at <= end && p.end_at >= start)

    await stream.writeSSE({
      event: 'start',
      data: JSON.stringify({ promo_count: inPeriod.length }),
    })

    let processed = 0
    for (const p of inPeriod) {
      const [pnl] = await db.select().from(promo_pnl).where(eq(promo_pnl.promo_id, p.id))
      const [cann] = await db
        .select()
        .from(cannibalization_results)
        .where(eq(cannibalization_results.promo_id, p.id))
      const trueContribution =
        (pnl?.contribution_cents ?? 0) - (cann?.dollar_adjustment_cents ?? 0)
      processed++
      await stream.writeSSE({
        event: 'promo',
        data: JSON.stringify({
          processed,
          total: inPeriod.length,
          promo_id: p.id,
          name: p.name,
          true_contribution_cents: trueContribution,
        }),
      })
    }

    const payload = await buildPeriodPayload(userId, start, end)
    await stream.writeSSE({ event: 'done', data: JSON.stringify(payload) })
  })
})

export default router
