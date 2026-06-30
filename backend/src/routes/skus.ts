import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { skus } from '../db/schema.js'
import { and, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const skuSchema = z.object({
  sku_code: z.string().min(1),
  name: z.string().min(1),
  collection: z.string().optional().nullable(),
  list_price_cents: z.number().int().min(0).optional().default(0),
  cogs_unit_cents: z.number().int().min(0).optional().default(0),
})

const bulkSchema = z.object({
  skus: z.array(skuSchema).min(1),
})

// GET / — public — list SKUs for a user (query ?user_id, falls back to header)
router.get('/', async (c) => {
  const userId =
    c.req.query('user_id') ??
    c.req.header('X-User-Id') ??
    c.req.header('x-user-id')
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(skus)
    .where(eq(skus.user_id, userId))
    .orderBy(skus.sku_code)
  return c.json(rows)
})

// GET /missing-cogs — auth — SKUs with cogs_unit_cents = 0
router.get('/missing-cogs', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(skus)
    .where(and(eq(skus.user_id, userId), eq(skus.cogs_unit_cents, 0)))
    .orderBy(skus.sku_code)
  return c.json(rows)
})

// GET /:id — public — one SKU
router.get('/:id', async (c) => {
  const [row] = await db.select().from(skus).where(eq(skus.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// POST / — auth — create SKU
router.post('/', authMiddleware, zValidator('json', skuSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [existing] = await db
    .select()
    .from(skus)
    .where(and(eq(skus.user_id, userId), eq(skus.sku_code, body.sku_code)))
  if (existing) return c.json({ error: 'SKU code already exists' }, 409)
  const [row] = await db
    .insert(skus)
    .values({ ...body, user_id: userId })
    .returning()
  return c.json(row, 201)
})

// PUT /:id — auth — update SKU
router.put('/:id', authMiddleware, zValidator('json', skuSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(skus).where(eq(skus.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [row] = await db
    .update(skus)
    .set({ ...body, updated_at: new Date() })
    .where(eq(skus.id, id))
    .returning()
  return c.json(row)
})

// DELETE /:id — auth — delete SKU
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(skus).where(eq(skus.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(skus).where(eq(skus.id, id))
  return c.json({ success: true })
})

// POST /bulk — auth — bulk import; upserts on (user_id, sku_code)
router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  let inserted = 0
  for (const s of body.skus) {
    await db
      .insert(skus)
      .values({ ...s, user_id: userId })
      .onConflictDoUpdate({
        target: [skus.user_id, skus.sku_code],
        set: {
          name: s.name,
          collection: s.collection ?? null,
          list_price_cents: s.list_price_cents ?? 0,
          cogs_unit_cents: s.cogs_unit_cents ?? 0,
          updated_at: new Date(),
        },
      })
    inserted += 1
  }
  return c.json({ inserted }, 201)
})

export default router
