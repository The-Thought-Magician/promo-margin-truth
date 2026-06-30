import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  incrementality_results,
  promos,
  order_lines,
  workspaces,
  activity_log,
} from '../db/schema.js'
import { eq, and, gte, lt, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const computeSchema = z.object({
  method: z.enum(['pre_period', 'control', 'blended']).default('pre_period'),
})

const DAY_MS = 86_400_000

// Public: incrementality results for a promo (all methods)
router.get('/:promoId', async (c) => {
  const promoId = c.req.param('promoId')
  const rows = await db
    .select()
    .from(incrementality_results)
    .where(eq(incrementality_results.promo_id, promoId))
    .orderBy(desc(incrementality_results.computed_at))
  return c.json(rows)
})

// Auth: compute baseline via pre_period | control | blended and upsert
router.post('/:promoId/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const promoId = c.req.param('promoId')
  const { method } = c.req.valid('json')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  let [ws] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (!ws) {
    ;[ws] = await db.insert(workspaces).values({ user_id: userId }).returning()
  }
  const prePeriodDays = ws.pre_period_days ?? 28

  const start = new Date(promo.start_at)
  const end = new Date(promo.end_at)
  const promoDurationMs = Math.max(DAY_MS, end.getTime() - start.getTime())
  const promoDurationDays = promoDurationMs / DAY_MS

  // Observed units + revenue during the promo window for this promo.
  const promoLines = await db
    .select()
    .from(order_lines)
    .where(and(eq(order_lines.user_id, userId), eq(order_lines.promo_id, promoId)))

  let observedUnits = 0
  let observedRevenueCents = 0
  for (const l of promoLines) {
    const qty = l.qty ?? 0
    observedUnits += qty
    observedRevenueCents += qty * l.unit_price_cents - l.discount_amount_cents
  }

  // Average net revenue per unit during the promo, for valuing incremental units.
  const netRevPerUnit = observedUnits > 0 ? observedRevenueCents / observedUnits : 0

  // --- pre_period baseline: same-SKU/user sales in the window immediately
  //     before the promo, scaled to the promo's duration (a daily run-rate). ---
  async function prePeriodBaselineUnits(): Promise<number> {
    const preStart = new Date(start.getTime() - prePeriodDays * DAY_MS)
    const preLines = await db
      .select()
      .from(order_lines)
      .where(
        and(
          eq(order_lines.user_id, userId),
          gte(order_lines.order_ts, preStart),
          lt(order_lines.order_ts, start),
        ),
      )
    let units = 0
    for (const l of preLines) units += l.qty ?? 0
    const dailyRate = prePeriodDays > 0 ? units / prePeriodDays : 0
    return dailyRate * promoDurationDays
  }

  // --- control baseline: non-promo order lines occurring DURING the promo
  //     window (a clean control of organic demand), scaled by share-of-window. ---
  async function controlBaselineUnits(): Promise<number> {
    const windowLines = await db
      .select()
      .from(order_lines)
      .where(
        and(
          eq(order_lines.user_id, userId),
          gte(order_lines.order_ts, start),
          lt(order_lines.order_ts, end),
        ),
      )
    let controlUnits = 0
    for (const l of windowLines) {
      if (l.promo_id !== promoId) controlUnits += l.qty ?? 0
    }
    return controlUnits
  }

  let baselineUnits: number
  if (method === 'pre_period') {
    baselineUnits = await prePeriodBaselineUnits()
  } else if (method === 'control') {
    baselineUnits = await controlBaselineUnits()
  } else {
    // blended: mean of pre-period and control baselines
    const a = await prePeriodBaselineUnits()
    const b = await controlBaselineUnits()
    baselineUnits = (a + b) / 2
  }

  const incrementalUnits = Math.max(0, observedUnits - baselineUnits)
  const incrementalRevenueCents = Math.round(incrementalUnits * netRevPerUnit)
  const incrementalityRatio = observedUnits > 0 ? incrementalUnits / observedUnits : 0

  // Confidence band: a +/-20% interval around the incrementality ratio, clamped
  // to [0, 1]. Wider when the baseline is sparse (fewer observed units).
  const spread = observedUnits >= 50 ? 0.2 : observedUnits >= 10 ? 0.35 : 0.5
  const confidenceLow = Math.max(0, incrementalityRatio * (1 - spread))
  const confidenceHigh = Math.min(1, incrementalityRatio * (1 + spread))

  const values = {
    user_id: userId,
    promo_id: promoId,
    method,
    baseline_units: baselineUnits,
    observed_units: observedUnits,
    incremental_units: incrementalUnits,
    incremental_revenue_cents: incrementalRevenueCents,
    incrementality_ratio: incrementalityRatio,
    confidence_low: confidenceLow,
    confidence_high: confidenceHigh,
    computed_at: new Date(),
  }

  const [row] = await db
    .insert(incrementality_results)
    .values(values)
    .onConflictDoUpdate({
      target: [incrementality_results.promo_id, incrementality_results.method],
      set: values,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'compute',
    entity: 'incrementality_result',
    entity_id: promoId,
    detail: { method, incremental_units: incrementalUnits, incrementality_ratio: incrementalityRatio },
  })

  return c.json(row, 201)
})

export default router
