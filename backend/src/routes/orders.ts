import { Hono } from 'hono'
import { db } from '../db/index.js'
import { order_lines } from '../db/schema.js'
import { eq, and, desc, sql } from 'drizzle-orm'

const router = new Hono()

function buildFilters(c: any) {
  const conds = []
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (userId) conds.push(eq(order_lines.user_id, userId))
  const promoId = c.req.query('promo_id')
  if (promoId) conds.push(eq(order_lines.promo_id, promoId))
  const skuCode = c.req.query('sku_code')
  if (skuCode) conds.push(eq(order_lines.sku_code, skuCode))
  const runId = c.req.query('run_id')
  if (runId) conds.push(eq(order_lines.ingestion_run_id, runId))
  return conds
}

// Public: list order_lines with filters (?promo_id&sku_code&run_id&limit)
router.get('/', async (c) => {
  const conds = buildFilters(c)
  const limitRaw = parseInt(c.req.query('limit') ?? '500', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 5000)) : 500
  const where = conds.length ? and(...conds) : undefined
  const rows = await db
    .select()
    .from(order_lines)
    .where(where)
    .orderBy(desc(order_lines.order_ts))
    .limit(limit)
  return c.json(rows)
})

// Public: aggregate summary totals (count, gross, discount, units)
router.get('/summary', async (c) => {
  const conds = buildFilters(c)
  const where = conds.length ? and(...conds) : undefined
  const [agg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      gross_revenue_cents: sql<number>`coalesce(sum(${order_lines.unit_price_cents} * ${order_lines.qty}), 0)::int`,
      discount_cents: sql<number>`coalesce(sum(${order_lines.discount_amount_cents}), 0)::int`,
      units: sql<number>`coalesce(sum(${order_lines.qty}), 0)::int`,
      cogs_cents: sql<number>`coalesce(sum(${order_lines.cogs_unit_cents} * ${order_lines.qty}), 0)::int`,
      orders: sql<number>`count(distinct ${order_lines.order_id})::int`,
    })
    .from(order_lines)
    .where(where)

  const gross = agg?.gross_revenue_cents ?? 0
  const discount = agg?.discount_cents ?? 0
  const summary = {
    count: agg?.count ?? 0,
    orders: agg?.orders ?? 0,
    units: agg?.units ?? 0,
    gross_revenue_cents: gross,
    discount_cents: discount,
    net_revenue_cents: gross - discount,
    cogs_cents: agg?.cogs_cents ?? 0,
  }
  return c.json({ summary })
})

export default router
