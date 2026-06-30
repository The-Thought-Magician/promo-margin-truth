import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  promo_pnl,
  promos,
  order_lines,
  skus,
  workspaces,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Public: list all promo P&L rows
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(promo_pnl)
        .where(eq(promo_pnl.user_id, userId))
        .orderBy(desc(promo_pnl.computed_at))
    : await db.select().from(promo_pnl).orderBy(desc(promo_pnl.computed_at))
  return c.json(rows)
})

// Public: P&L for a single promo
router.get('/:promoId', async (c) => {
  const promoId = c.req.param('promoId')
  const [row] = await db.select().from(promo_pnl).where(eq(promo_pnl.promo_id, promoId))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Auth: compute & upsert the gross->net->contribution waterfall for a promo
router.post('/:promoId/compute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const promoId = c.req.param('promoId')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Workspace config drives platform fee. Auto-create defaults if absent.
  let [ws] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (!ws) {
    ;[ws] = await db.insert(workspaces).values({ user_id: userId }).returning()
  }
  const platformFeePct = ws.platform_fee_pct ?? 0

  // Pull every order line attributed to this promo.
  const lines = await db
    .select()
    .from(order_lines)
    .where(and(eq(order_lines.user_id, userId), eq(order_lines.promo_id, promoId)))

  // SKU catalog for COGS fallback when a line has no per-line COGS.
  const skuRows = await db.select().from(skus).where(eq(skus.user_id, userId))
  const cogsBySku = new Map<string, number>()
  const listPriceBySku = new Map<string, number>()
  for (const s of skuRows) {
    cogsBySku.set(s.sku_code, s.cogs_unit_cents)
    listPriceBySku.set(s.sku_code, s.list_price_cents)
  }

  let grossRevenueCents = 0
  let discountCents = 0
  let cogsCents = 0
  let units = 0
  let listRevenueCents = 0
  const orderIds = new Set<string>()

  for (const l of lines) {
    const qty = l.qty ?? 0
    units += qty
    orderIds.add(l.order_id)
    // Gross = qty * unit price (pre-discount line value).
    grossRevenueCents += qty * l.unit_price_cents
    discountCents += l.discount_amount_cents
    // Per-line COGS preferred; fall back to SKU catalog COGS.
    const unitCogs = l.cogs_unit_cents > 0 ? l.cogs_unit_cents : cogsBySku.get(l.sku_code) ?? 0
    cogsCents += qty * unitCogs
    const listPrice = listPriceBySku.get(l.sku_code) ?? l.unit_price_cents
    listRevenueCents += qty * listPrice
  }

  const netRevenueCents = grossRevenueCents - discountCents
  const platformFeeCents = Math.round(netRevenueCents * (platformFeePct / 100))
  const contributionCents = netRevenueCents - cogsCents - platformFeeCents

  const realizedMarginPct = netRevenueCents > 0 ? (contributionCents / netRevenueCents) * 100 : 0
  // List margin: contribution measured against full list-price revenue (no discount).
  const listContributionCents = listRevenueCents - cogsCents - platformFeeCents
  const listMarginPct = listRevenueCents > 0 ? (listContributionCents / listRevenueCents) * 100 : 0

  const orderCount = orderIds.size
  const avgOrderValueCents = orderCount > 0 ? Math.round(netRevenueCents / orderCount) : 0

  const waterfall = [
    { label: 'Gross revenue', cents: grossRevenueCents },
    { label: 'Discount', cents: -discountCents },
    { label: 'Net revenue', cents: netRevenueCents },
    { label: 'COGS', cents: -cogsCents },
    { label: 'Platform fee', cents: -platformFeeCents },
    { label: 'Contribution', cents: contributionCents },
  ]

  const values = {
    user_id: userId,
    promo_id: promoId,
    gross_revenue_cents: grossRevenueCents,
    discount_cents: discountCents,
    net_revenue_cents: netRevenueCents,
    cogs_cents: cogsCents,
    platform_fee_cents: platformFeeCents,
    contribution_cents: contributionCents,
    realized_margin_pct: realizedMarginPct,
    list_margin_pct: listMarginPct,
    units,
    avg_order_value_cents: avgOrderValueCents,
    waterfall,
    computed_at: new Date(),
  }

  const [row] = await db
    .insert(promo_pnl)
    .values(values)
    .onConflictDoUpdate({ target: promo_pnl.promo_id, set: values })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'compute',
    entity: 'promo_pnl',
    entity_id: promoId,
    detail: { contribution_cents: contributionCents, units },
  })

  return c.json(row, 201)
})

export default router
