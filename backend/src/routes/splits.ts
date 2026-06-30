import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  promos,
  order_lines,
  workspaces,
  customer_splits,
  activity_log,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /:promoId — Public — new-vs-existing customer split for a promo
// ---------------------------------------------------------------------------
router.get('/:promoId', async (c) => {
  const promoId = c.req.param('promoId')
  const [split] = await db
    .select()
    .from(customer_splits)
    .where(eq(customer_splits.promo_id, promoId))
  return c.json(split ?? null)
})

// ---------------------------------------------------------------------------
// POST /:promoId/compute — Auth — split the promo's contribution between new
// (is_first_order) and existing customers, then upsert.
// ---------------------------------------------------------------------------
router.post('/:promoId/compute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const promoId = c.req.param('promoId')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  const platformFeePct = ws?.platform_fee_pct ?? 0

  const startMs = new Date(promo.start_at).getTime()
  const endMs = new Date(promo.end_at).getTime()

  const lines = await db.select().from(order_lines).where(eq(order_lines.user_id, userId))

  // Lines attributed to this promo: explicitly linked, or within the window.
  const promoLines = lines.filter((l) => {
    if (l.promo_id === promoId) return true
    const t = new Date(l.order_ts).getTime()
    return t >= startMs && t < endMs
  })

  // A customer counts as "new" if ANY of their lines in this promo is a first
  // order; otherwise existing. Contribution is computed per line and summed by
  // the owning customer's new/existing classification.
  const customerIsNew = new Map<string, boolean>()
  for (const l of promoLines) {
    if (l.is_first_order) customerIsNew.set(l.customer_id, true)
    else if (!customerIsNew.has(l.customer_id)) customerIsNew.set(l.customer_id, false)
  }

  let newContributionCents = 0
  let existingContributionCents = 0
  let existingDiscountCents = 0
  const newCustomers = new Set<string>()
  const existingCustomers = new Set<string>()

  for (const l of promoLines) {
    const gross = l.unit_price_cents * l.qty
    const net = gross - l.discount_amount_cents
    const cogs = l.cogs_unit_cents * l.qty
    const platformFee = Math.round((net * platformFeePct) / 100)
    const contribution = net - cogs - platformFee
    const isNew = customerIsNew.get(l.customer_id) === true
    if (isNew) {
      newContributionCents += contribution
      newCustomers.add(l.customer_id)
    } else {
      existingContributionCents += contribution
      existingDiscountCents += l.discount_amount_cents
      existingCustomers.add(l.customer_id)
    }
  }

  // Existing-customer subsidy: discount dollars handed to customers who were
  // already buying (the cost of discounting demand you would have captured).
  const existingSubsidyCents = existingDiscountCents

  const values = {
    user_id: userId,
    promo_id: promoId,
    new_count: newCustomers.size,
    existing_count: existingCustomers.size,
    new_contribution_cents: newContributionCents,
    existing_contribution_cents: existingContributionCents,
    existing_subsidy_cents: existingSubsidyCents,
    computed_at: new Date(),
  }

  const [row] = await db
    .insert(customer_splits)
    .values(values)
    .onConflictDoUpdate({
      target: customer_splits.promo_id,
      set: {
        new_count: values.new_count,
        existing_count: values.existing_count,
        new_contribution_cents: values.new_contribution_cents,
        existing_contribution_cents: values.existing_contribution_cents,
        existing_subsidy_cents: values.existing_subsidy_cents,
        computed_at: values.computed_at,
      },
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'compute',
    entity: 'split',
    entity_id: promoId,
    detail: { new_count: values.new_count, existing_count: values.existing_count },
  })

  return c.json(row, 201)
})

export default router
