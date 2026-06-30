import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { column_mappings, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const mappingSchema = z.object({
  name: z.string().min(1),
  mapping: z.record(z.string(), z.string()).default({}),
})

// Public: list saved CSV header -> canonical column mappings
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(column_mappings)
        .where(eq(column_mappings.user_id, userId))
        .orderBy(desc(column_mappings.created_at))
    : await db.select().from(column_mappings).orderBy(desc(column_mappings.created_at))
  return c.json(rows)
})

// Auth: save a new mapping
router.post('/', authMiddleware, zValidator('json', mappingSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(column_mappings)
    .values({ user_id: userId, name: body.name, mapping: body.mapping })
    .returning()
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'create',
    entity: 'column_mapping',
    entity_id: created.id,
    detail: { name: created.name },
  })
  return c.json(created, 201)
})

// Auth: update a mapping
router.put('/:id', authMiddleware, zValidator('json', mappingSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(column_mappings).where(eq(column_mappings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(column_mappings)
    .set({ ...body })
    .where(eq(column_mappings.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete a mapping
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(column_mappings).where(eq(column_mappings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(column_mappings).where(eq(column_mappings.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'column_mapping',
    entity_id: id,
    detail: { name: existing.name },
  })
  return c.json({ success: true })
})

export default router
