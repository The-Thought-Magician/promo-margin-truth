import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  promos,
  order_lines,
  workspaces,
  cannibalization_results,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const DAY_MS = 86_400_000

const computeSchema = z
  .object({
    pull_forward_days: z.number().int().positive().max(365).optional(),
  })
  .optional()

// ---------------------------------------------------------------------------
// GET /:promoId — Public — cannibalization result for a promo
// ---------------------------------------------------------------------------
router.get('/:promoId', async (c) => {
  const promoId = c.req.param('promoId')
  const [result] = await db
    .select()
    .from(cannibalization_results)
    .where(eq(cannibalization_results.promo_id, promoId))
  return c.json(result ?? null)
})

// ---------------------------------------------------------------------------
// POST /:promoId/compute — Auth — compute pull-forward + cross-SKU +
// already-converting share + dollar adjustment, then upsert.
// ---------------------------------------------------------------------------
router.post(
  '/:promoId/compute',
  authMiddleware,
  zValidator('json', computeSchema),
  async (c) => {
    const userId = getUserId(c)
    const promoId = c.req.param('promoId')
    const body = c.req.valid('json') ?? {}

    const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
    if (!promo) return c.json({ error: 'Promo not found' }, 404)
    if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
    const pullForwardDays =
      body.pull_forward_days ?? ws?.pull_forward_days ?? 14

    const startMs = new Date(promo.start_at).getTime()
    const endMs = new Date(promo.end_at).getTime()
    const promoDurationDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS))

    // The "pull-forward window" is the equally long stretch immediately AFTER
    // the promo ends, capped at pull_forward_days. Demand that should have
    // landed there but instead landed during the discount window is the
    // pull-forward (cannibalized) demand.
    const postStartMs = endMs
    const postEndMs = endMs + Math.min(pullForwardDays, promoDurationDays) * DAY_MS

    // Pre-period of the same length immediately BEFORE the promo, used as the
    // organic baseline rate of demand for the eligible SKUs.
    const preEndMs = startMs
    const preStartMs = startMs - Math.min(pullForwardDays, promoDurationDays) * DAY_MS

    // Pull all of this user's order lines once, then bucket in memory. order_ts
    // is the authoritative event time.
    const lines = await db
      .select()
      .from(order_lines)
      .where(eq(order_lines.user_id, userId))

    const eligible = new Set<string>(
      Array.isArray(promo.eligible_skus) ? (promo.eligible_skus as string[]) : [],
    )
    const restrictToEligible = eligible.size > 0
    const isEligibleSku = (sku: string) => !restrictToEligible || eligible.has(sku)

    // Bucket order lines by window.
    let promoUnits = 0
    let promoEligibleUnits = 0
    let promoNetRevenueCents = 0
    let promoCrossSkuRevenueCents = 0
    let preEligibleUnits = 0
    let postEligibleUnits = 0

    // Customers that bought eligible SKUs in the pre-period (the
    // "already-converting" cohort that would have purchased anyway).
    const preBuyers = new Set<string>()
    const promoBuyers = new Set<string>()

    for (const l of lines) {
      const t = new Date(l.order_ts).getTime()
      const net = l.unit_price_cents * l.qty - l.discount_amount_cents
      const attachedToPromo = l.promo_id === promoId
      const inPromoWindow = t >= startMs && t < endMs

      if (attachedToPromo || inPromoWindow) {
        promoUnits += l.qty
        promoNetRevenueCents += net
        if (isEligibleSku(l.sku_code)) {
          promoEligibleUnits += l.qty
          promoBuyers.add(l.customer_id)
        } else {
          // Bought a non-discounted (ineligible) SKU within the promo order
          // context: cross-SKU revenue lifted by the promo.
          promoCrossSkuRevenueCents += net
        }
      }

      if (t >= preStartMs && t < preEndMs && isEligibleSku(l.sku_code)) {
        preEligibleUnits += l.qty
        preBuyers.add(l.customer_id)
      }

      if (t >= postStartMs && t < postEndMs && isEligibleSku(l.sku_code)) {
        postEligibleUnits += l.qty
      }
    }

    // Pull-forward: demand that the post-window LOST relative to the organic
    // (pre-period) rate is treated as having been pulled forward into the promo.
    const pullForwardUnits = Math.max(0, preEligibleUnits - postEligibleUnits)

    // Value the pulled-forward units at the promo's realized net price per unit.
    const netPerEligibleUnit =
      promoEligibleUnits > 0
        ? (promoNetRevenueCents - promoCrossSkuRevenueCents) / promoEligibleUnits
        : 0
    const pullForwardRevenueCents = Math.round(pullForwardUnits * netPerEligibleUnit)

    // Already-converting share: fraction of promo buyers who already bought in
    // the pre-period (they did not need the discount to convert).
    let alreadyConverting = 0
    for (const cust of promoBuyers) if (preBuyers.has(cust)) alreadyConverting++
    const alreadyConvertingPct =
      promoBuyers.size > 0 ? alreadyConverting / promoBuyers.size : 0

    // Dollar adjustment: cannibalized revenue that should NOT be credited to the
    // promo = pull-forward revenue + discount subsidy on already-converting
    // demand. We approximate the subsidy as the already-converting share of the
    // promo's discount, valued from the discount applied to eligible lines.
    const promoDiscountEligibleCents = lines.reduce((acc, l) => {
      const t = new Date(l.order_ts).getTime()
      const inPromo = l.promo_id === promoId || (t >= startMs && t < endMs)
      if (inPromo && isEligibleSku(l.sku_code)) return acc + l.discount_amount_cents
      return acc
    }, 0)
    const alreadyConvertingSubsidyCents = Math.round(
      promoDiscountEligibleCents * alreadyConvertingPct,
    )

    const dollarAdjustmentCents =
      pullForwardRevenueCents + alreadyConvertingSubsidyCents - promoCrossSkuRevenueCents

    const detail = {
      pull_forward_days: pullForwardDays,
      promo_duration_days: promoDurationDays,
      pre_eligible_units: preEligibleUnits,
      post_eligible_units: postEligibleUnits,
      promo_eligible_units: promoEligibleUnits,
      promo_buyers: promoBuyers.size,
      already_converting_buyers: alreadyConverting,
      net_per_eligible_unit_cents: Math.round(netPerEligibleUnit),
      promo_discount_eligible_cents: promoDiscountEligibleCents,
      already_converting_subsidy_cents: alreadyConvertingSubsidyCents,
      cross_sku_revenue_cents: promoCrossSkuRevenueCents,
    }

    const values = {
      user_id: userId,
      promo_id: promoId,
      pull_forward_units: pullForwardUnits,
      pull_forward_revenue_cents: pullForwardRevenueCents,
      cross_sku_revenue_cents: promoCrossSkuRevenueCents,
      already_converting_pct: alreadyConvertingPct,
      dollar_adjustment_cents: dollarAdjustmentCents,
      detail,
      computed_at: new Date(),
    }

    const [row] = await db
      .insert(cannibalization_results)
      .values(values)
      .onConflictDoUpdate({
        target: cannibalization_results.promo_id,
        set: {
          pull_forward_units: values.pull_forward_units,
          pull_forward_revenue_cents: values.pull_forward_revenue_cents,
          cross_sku_revenue_cents: values.cross_sku_revenue_cents,
          already_converting_pct: values.already_converting_pct,
          dollar_adjustment_cents: values.dollar_adjustment_cents,
          detail: values.detail,
          computed_at: values.computed_at,
        },
      })
      .returning()

    await db.insert(activity_log).values({
      user_id: userId,
      action: 'compute',
      entity: 'cannibalization',
      entity_id: promoId,
      detail: { dollar_adjustment_cents: dollarAdjustmentCents },
    })

    return c.json(row, 201)
  },
)

export default router
