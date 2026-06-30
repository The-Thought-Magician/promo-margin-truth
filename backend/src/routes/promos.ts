import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { promos, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const PROMO_TYPES = [
  'sitewide_pct',
  'category_pct',
  'sku_pct',
  'fixed_amount',
  'bogo',
  'free_shipping',
  'bundle',
] as const

const PROMO_STATUSES = ['planned', 'active', 'ended', 'analyzed'] as const

const promoSchema = z.object({
  name: z.string().min(1),
  promo_type: z.enum(PROMO_TYPES).optional().default('sitewide_pct'),
  discount_depth_pct: z.number().min(0).max(100).optional().default(0),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  status: z.enum(PROMO_STATUSES).optional().default('planned'),
  campaign_tag: z.string().optional().nullable(),
  channel_scope: z.array(z.string()).optional().default([]),
  eligible_skus: z.array(z.string()).optional().default([]),
  owner: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const cloneSchema = z.object({
  name: z.string().min(1).optional(),
  start_at: z.string().min(1).optional(),
  end_at: z.string().min(1).optional(),
})

const statusSchema = z.object({
  status: z.enum(PROMO_STATUSES),
})

function toValues(body: z.infer<typeof promoSchema>) {
  return {
    name: body.name,
    promo_type: body.promo_type,
    discount_depth_pct: body.discount_depth_pct,
    start_at: new Date(body.start_at),
    end_at: new Date(body.end_at),
    status: body.status,
    campaign_tag: body.campaign_tag ?? null,
    channel_scope: body.channel_scope ?? [],
    eligible_skus: body.eligible_skus ?? [],
    owner: body.owner ?? null,
    notes: body.notes ?? null,
  }
}

async function logActivity(
  userId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(activity_log).values({
      user_id: userId,
      action,
      entity: 'promo',
      entity_id: entityId,
      detail,
    })
  } catch {
    // activity logging is best-effort
  }
}

// Public: list promos for a user
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db.select().from(promos).where(eq(promos.user_id, userId)).orderBy(desc(promos.created_at))
    : await db.select().from(promos).orderBy(desc(promos.created_at))
  return c.json(rows)
})

// Public: one promo
router.get('/:id', async (c) => {
  const [row] = await db.select().from(promos).where(eq(promos.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Auth: create promo
router.post('/', authMiddleware, zValidator('json', promoSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(promos)
    .values({ ...toValues(body), user_id: userId })
    .returning()
  await logActivity(userId, 'create', row.id, { name: row.name })
  return c.json(row, 201)
})

// Auth: update promo
router.put('/:id', authMiddleware, zValidator('json', promoSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(promos).where(eq(promos.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.promo_type !== undefined) patch.promo_type = body.promo_type
  if (body.discount_depth_pct !== undefined) patch.discount_depth_pct = body.discount_depth_pct
  if (body.start_at !== undefined) patch.start_at = new Date(body.start_at)
  if (body.end_at !== undefined) patch.end_at = new Date(body.end_at)
  if (body.status !== undefined) patch.status = body.status
  if (body.campaign_tag !== undefined) patch.campaign_tag = body.campaign_tag ?? null
  if (body.channel_scope !== undefined) patch.channel_scope = body.channel_scope
  if (body.eligible_skus !== undefined) patch.eligible_skus = body.eligible_skus
  if (body.owner !== undefined) patch.owner = body.owner ?? null
  if (body.notes !== undefined) patch.notes = body.notes ?? null
  const [updated] = await db.update(promos).set(patch).where(eq(promos.id, id)).returning()
  await logActivity(userId, 'update', id, {})
  return c.json(updated)
})

// Auth: delete promo
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(promos).where(eq(promos.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(promos).where(eq(promos.id, id))
  await logActivity(userId, 'delete', id, { name: existing.name })
  return c.json({ success: true })
})

// Auth: clone promo (new name/window)
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(promos).where(eq(promos.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(promos)
    .values({
      user_id: userId,
      name: body.name ?? `${existing.name} (copy)`,
      promo_type: existing.promo_type,
      discount_depth_pct: existing.discount_depth_pct,
      start_at: body.start_at ? new Date(body.start_at) : existing.start_at,
      end_at: body.end_at ? new Date(body.end_at) : existing.end_at,
      status: 'planned',
      campaign_tag: existing.campaign_tag,
      channel_scope: existing.channel_scope ?? [],
      eligible_skus: existing.eligible_skus ?? [],
      owner: existing.owner,
      notes: existing.notes,
    })
    .returning()
  await logActivity(userId, 'clone', row.id, { from: id })
  return c.json(row, 201)
})

// Auth: set status (planned|active|ended|analyzed)
router.post('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(promos).where(eq(promos.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const { status } = c.req.valid('json')
  const [updated] = await db
    .update(promos)
    .set({ status, updated_at: new Date() })
    .where(eq(promos.id, id))
    .returning()
  await logActivity(userId, 'status', id, { status })
  return c.json(updated)
})

export default router
