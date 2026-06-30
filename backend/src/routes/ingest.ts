import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  ingestion_runs,
  order_lines,
  promos,
  skus,
  column_mappings,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const orderLineInput = z.object({
  order_id: z.string().min(1),
  sku_code: z.string().min(1),
  qty: z.coerce.number().int().optional().default(1),
  unit_price_cents: z.coerce.number().int().optional().default(0),
  discount_amount_cents: z.coerce.number().int().optional().default(0),
  cogs_unit_cents: z.coerce.number().int().optional().default(0),
  customer_id: z.string().min(1),
  order_ts: z.string().min(1),
  campaign_tag: z.string().optional().nullable(),
  channel: z.string().optional().nullable(),
  is_first_order: z.coerce.boolean().optional().default(false),
})

const uploadSchema = z.object({
  filename: z.string().min(1),
  rows: z.array(z.record(z.string(), z.any())).min(1),
  mappingName: z.string().optional(),
})

async function logActivity(
  userId: string,
  action: string,
  entityId: string | null,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(activity_log).values({
      user_id: userId,
      action,
      entity: 'ingestion_run',
      entity_id: entityId,
      detail,
    })
  } catch {
    // best-effort
  }
}

// Map a raw CSV row through a mapping (canonical -> source header) if provided.
function applyMapping(
  raw: Record<string, any>,
  mapping: Record<string, string> | null,
): Record<string, any> {
  if (!mapping || Object.keys(mapping).length === 0) return raw
  const out: Record<string, any> = {}
  for (const [canonical, source] of Object.entries(mapping)) {
    if (source && raw[source] !== undefined) out[canonical] = raw[source]
  }
  // keep any already-canonical keys that were not remapped
  for (const [k, v] of Object.entries(raw)) {
    if (out[k] === undefined) out[k] = v
  }
  return out
}

// Find the promo (for this user) whose campaign_tag matches and/or whose
// window contains the order timestamp. campaign_tag match wins; otherwise the
// window match.
function matchPromo(
  line: { campaign_tag?: string | null; order_ts: Date },
  userPromos: Array<{
    id: string
    campaign_tag: string | null
    start_at: Date
    end_at: Date
  }>,
): string | null {
  const ts = line.order_ts.getTime()
  if (line.campaign_tag) {
    const tagged = userPromos.find((p) => p.campaign_tag && p.campaign_tag === line.campaign_tag)
    if (tagged) return tagged.id
  }
  const windowed = userPromos.find(
    (p) => ts >= p.start_at.getTime() && ts <= p.end_at.getTime(),
  )
  return windowed ? windowed.id : null
}

// ---------------------------------------------------------------------------
// Run list / detail
// ---------------------------------------------------------------------------

// Public: list ingestion runs
router.get('/runs', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(ingestion_runs)
        .where(eq(ingestion_runs.user_id, userId))
        .orderBy(desc(ingestion_runs.created_at))
    : await db.select().from(ingestion_runs).orderBy(desc(ingestion_runs.created_at))
  return c.json(rows)
})

// Public: run detail
router.get('/runs/:id', async (c) => {
  const [run] = await db.select().from(ingestion_runs).where(eq(ingestion_runs.id, c.req.param('id')))
  if (!run) return c.json({ error: 'Not found' }, 404)
  return c.json(run)
})

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

// Auth: accept { filename, rows, mappingName? }, validate, insert order_lines,
// attach promo by campaign_tag/window, create run.
router.post('/upload', authMiddleware, zValidator('json', uploadSchema), async (c) => {
  const userId = getUserId(c)
  const { filename, rows, mappingName } = c.req.valid('json')

  let mapping: Record<string, string> | null = null
  if (mappingName) {
    const [m] = await db
      .select()
      .from(column_mappings)
      .where(and(eq(column_mappings.user_id, userId), eq(column_mappings.name, mappingName)))
    if (m) mapping = (m.mapping as Record<string, string>) ?? null
  }

  const userPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
  const promoIndex = userPromos.map((p) => ({
    id: p.id,
    campaign_tag: p.campaign_tag,
    start_at: p.start_at,
    end_at: p.end_at,
  }))

  const errors: Array<{ row: number; message: string }> = []
  const toInsert: Array<typeof order_lines.$inferInsert> = []
  let firstOrderCount = 0

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping)
    const parsed = orderLineInput.safeParse(mapped)
    if (!parsed.success) {
      errors.push({ row: i + 1, message: parsed.error.issues.map((e) => e.message).join('; ') })
      continue
    }
    const v = parsed.data
    const orderTs = new Date(v.order_ts)
    if (Number.isNaN(orderTs.getTime())) {
      errors.push({ row: i + 1, message: 'Invalid order_ts' })
      continue
    }
    const promoId = matchPromo({ campaign_tag: v.campaign_tag, order_ts: orderTs }, promoIndex)
    if (v.is_first_order) firstOrderCount++
    toInsert.push({
      user_id: userId,
      promo_id: promoId,
      order_id: v.order_id,
      sku_code: v.sku_code,
      qty: v.qty,
      unit_price_cents: v.unit_price_cents,
      discount_amount_cents: v.discount_amount_cents,
      cogs_unit_cents: v.cogs_unit_cents,
      customer_id: v.customer_id,
      order_ts: orderTs,
      campaign_tag: v.campaign_tag ?? null,
      channel: v.channel ?? null,
      is_first_order: v.is_first_order,
    })
  }

  const grossCents = toInsert.reduce((s, l) => s + (l.unit_price_cents ?? 0) * (l.qty ?? 1), 0)
  const discountCents = toInsert.reduce((s, l) => s + (l.discount_amount_cents ?? 0), 0)
  const attached = toInsert.filter((l) => l.promo_id).length

  const [run] = await db
    .insert(ingestion_runs)
    .values({
      user_id: userId,
      filename,
      source: 'csv',
      row_count: rows.length,
      error_count: errors.length,
      status: errors.length === rows.length ? 'failed' : 'completed',
      summary: {
        inserted: toInsert.length,
        attached_to_promo: attached,
        first_orders: firstOrderCount,
        gross_revenue_cents: grossCents,
        discount_cents: discountCents,
      },
      errors,
    })
    .returning()

  if (toInsert.length > 0) {
    const withRun = toInsert.map((l) => ({ ...l, ingestion_run_id: run.id }))
    // chunk inserts to keep parameter counts sane
    const chunkSize = 500
    for (let i = 0; i < withRun.length; i += chunkSize) {
      await db.insert(order_lines).values(withRun.slice(i, i + chunkSize))
    }
  }

  await logActivity(userId, 'upload', run.id, { filename, inserted: toInsert.length, errors: errors.length })
  return c.json({ run }, 201)
})

// ---------------------------------------------------------------------------
// Delete run + its order_lines
// ---------------------------------------------------------------------------

router.delete('/runs/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [run] = await db.select().from(ingestion_runs).where(eq(ingestion_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  if (run.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(order_lines).where(eq(order_lines.ingestion_run_id, id))
  await db.delete(ingestion_runs).where(eq(ingestion_runs.id, id))
  await logActivity(userId, 'delete', id, { filename: run.filename })
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Sample-data seeder
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

// Auth: seed a demo brand (SKUs, promos incl. one money-losing, order_lines, run).
router.post('/sample', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // --- SKUs (list price / cogs in cents) ---
  const skuDefs = [
    { sku_code: 'TEE-CLASSIC', name: 'Classic Tee', collection: 'Apparel', list_price_cents: 3500, cogs_unit_cents: 1200 },
    { sku_code: 'HOODIE-PRO', name: 'Pro Hoodie', collection: 'Apparel', list_price_cents: 8900, cogs_unit_cents: 3800 },
    { sku_code: 'CAP-LOGO', name: 'Logo Cap', collection: 'Accessories', list_price_cents: 2500, cogs_unit_cents: 900 },
    { sku_code: 'MUG-CERAMIC', name: 'Ceramic Mug', collection: 'Home', list_price_cents: 1800, cogs_unit_cents: 1100 },
    { sku_code: 'BOTTLE-STEEL', name: 'Steel Bottle', collection: 'Home', list_price_cents: 3200, cogs_unit_cents: 1500 },
  ]

  const insertedSkus = []
  for (const s of skuDefs) {
    const [row] = await db
      .insert(skus)
      .values({ ...s, user_id: userId })
      .onConflictDoUpdate({
        target: [skus.user_id, skus.sku_code],
        set: {
          name: s.name,
          collection: s.collection,
          list_price_cents: s.list_price_cents,
          cogs_unit_cents: s.cogs_unit_cents,
          updated_at: new Date(),
        },
      })
      .returning()
    insertedSkus.push(row)
  }
  const cogsByCode = new Map(skuDefs.map((s) => [s.sku_code, s.cogs_unit_cents]))
  const priceByCode = new Map(skuDefs.map((s) => [s.sku_code, s.list_price_cents]))

  // --- Promos: one healthy, one money-losing (deep discount on thin margin) ---
  const healthyPromo = {
    user_id: userId,
    name: 'Spring Fresh 15%',
    promo_type: 'sitewide_pct',
    discount_depth_pct: 15,
    start_at: daysAgo(40),
    end_at: daysAgo(33),
    status: 'ended' as const,
    campaign_tag: 'spring_fresh',
    channel_scope: ['web', 'email'],
    eligible_skus: [],
    owner: 'demo',
    notes: 'Healthy modest-depth sitewide promo.',
  }
  const losingPromo = {
    user_id: userId,
    name: 'Doorbuster 50% Blowout',
    promo_type: 'sitewide_pct',
    discount_depth_pct: 50,
    start_at: daysAgo(20),
    end_at: daysAgo(13),
    status: 'ended' as const,
    campaign_tag: 'doorbuster',
    channel_scope: ['web', 'paid_social'],
    eligible_skus: [],
    owner: 'demo',
    notes: 'Money-losing: 50% off drives contribution below COGS+fees.',
  }

  const [promoHealthy] = await db.insert(promos).values(healthyPromo).returning()
  const [promoLosing] = await db.insert(promos).values(losingPromo).returning()

  // --- Order lines ---
  const channels = ['web', 'email', 'paid_social']
  const lines: Array<typeof order_lines.$inferInsert> = []

  function seedOrders(
    promo: { id: string; campaign_tag: string | null; start_at: Date; end_at: Date; discount_depth_pct: number },
    orderCount: number,
    prefix: string,
  ) {
    const span = promo.end_at.getTime() - promo.start_at.getTime()
    for (let o = 0; o < orderCount; o++) {
      const orderId = `${prefix}-${o + 1}`
      const customerId = `cust-${prefix}-${(o % Math.max(1, Math.floor(orderCount * 0.7))) + 1}`
      const isFirst = o % 3 === 0
      const ts = new Date(promo.start_at.getTime() + Math.floor((span * (o + 0.5)) / orderCount))
      const channel = channels[o % channels.length]
      const lineCount = (o % 2) + 1
      for (let li = 0; li < lineCount; li++) {
        const def = skuDefs[(o + li) % skuDefs.length]
        const qty = (o % 3) + 1
        const listPrice = priceByCode.get(def.sku_code) ?? 0
        const discountPerUnit = Math.round((listPrice * promo.discount_depth_pct) / 100)
        lines.push({
          user_id: userId,
          promo_id: promo.id,
          order_id: orderId,
          sku_code: def.sku_code,
          qty,
          unit_price_cents: listPrice,
          discount_amount_cents: discountPerUnit * qty,
          cogs_unit_cents: cogsByCode.get(def.sku_code) ?? 0,
          customer_id: customerId,
          order_ts: ts,
          campaign_tag: promo.campaign_tag,
          channel,
          is_first_order: isFirst && li === 0,
        })
      }
    }
  }

  seedOrders(promoHealthy, 24, 'SPR')
  seedOrders(promoLosing, 30, 'DBL')

  // a handful of baseline (no-promo) orders before the promos for incrementality
  for (let o = 0; o < 18; o++) {
    const def = skuDefs[o % skuDefs.length]
    const qty = (o % 2) + 1
    const listPrice = priceByCode.get(def.sku_code) ?? 0
    lines.push({
      user_id: userId,
      promo_id: null,
      order_id: `BASE-${o + 1}`,
      sku_code: def.sku_code,
      qty,
      unit_price_cents: listPrice,
      discount_amount_cents: 0,
      cogs_unit_cents: cogsByCode.get(def.sku_code) ?? 0,
      customer_id: `cust-base-${(o % 12) + 1}`,
      order_ts: daysAgo(60 + (o % 25)),
      campaign_tag: null,
      channel: channels[o % channels.length],
      is_first_order: o % 4 === 0,
    })
  }

  const grossCents = lines.reduce((s, l) => s + (l.unit_price_cents ?? 0) * (l.qty ?? 1), 0)
  const discountCents = lines.reduce((s, l) => s + (l.discount_amount_cents ?? 0), 0)

  const [run] = await db
    .insert(ingestion_runs)
    .values({
      user_id: userId,
      filename: 'sample-demo-brand.csv',
      source: 'sample',
      row_count: lines.length,
      error_count: 0,
      status: 'completed',
      summary: {
        inserted: lines.length,
        promos: 2,
        skus: skuDefs.length,
        gross_revenue_cents: grossCents,
        discount_cents: discountCents,
        money_losing_promo: promoLosing.name,
      },
      errors: [],
    })
    .returning()

  const withRun = lines.map((l) => ({ ...l, ingestion_run_id: run.id }))
  const chunkSize = 500
  for (let i = 0; i < withRun.length; i += chunkSize) {
    await db.insert(order_lines).values(withRun.slice(i, i + chunkSize))
  }

  await logActivity(userId, 'sample', run.id, { lines: lines.length })

  return c.json(
    { run, promos: [promoHealthy, promoLosing], skus: insertedSkus },
    201,
  )
})

export default router
