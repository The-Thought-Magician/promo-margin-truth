import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { cogs_overrides, skus } from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const overrideSchema = z.object({
  sku_id: z.string().min(1),
  cogs_unit_cents: z.number().int().min(0),
  effective_from: z.string().min(1),
  note: z.string().optional().nullable(),
})

// GET / — public — list cogs overrides (query ?sku_id, optional ?user_id)
router.get('/', async (c) => {
  const skuId = c.req.query('sku_id')
  const userId =
    c.req.query('user_id') ??
    c.req.header('X-User-Id') ??
    c.req.header('x-user-id')

  const conditions = []
  if (skuId) conditions.push(eq(cogs_overrides.sku_id, skuId))
  if (userId) conditions.push(eq(cogs_overrides.user_id, userId))

  if (!skuId && !userId) return c.json([])

  const rows = await db
    .select()
    .from(cogs_overrides)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(cogs_overrides.effective_from))
  return c.json(rows)
})

// POST / — auth — create effective-dated COGS override
router.post('/', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const effective = new Date(body.effective_from)
  if (Number.isNaN(effective.getTime())) {
    return c.json({ error: 'effective_from must be a valid ISO instant' }, 400)
  }

  // The SKU must exist and belong to the caller.
  const [sku] = await db.select().from(skus).where(eq(skus.id, body.sku_id))
  if (!sku) return c.json({ error: 'SKU not found' }, 404)
  if (sku.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [row] = await db
    .insert(cogs_overrides)
    .values({
      user_id: userId,
      sku_id: body.sku_id,
      cogs_unit_cents: body.cogs_unit_cents,
      effective_from: effective,
      note: body.note ?? null,
    })
    .returning()
  return c.json(row, 201)
})

// DELETE /:id — auth — delete override (ownership check)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(cogs_overrides)
    .where(eq(cogs_overrides.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(cogs_overrides).where(eq(cogs_overrides.id, id))
  return c.json({ success: true })
})

export default router
