import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { segments, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const segmentSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1).optional().default('control'),
  criteria: z.record(z.string(), z.unknown()).optional().default({}),
})

// Public: list control/segment definitions (newest first; optional ?kind filter)
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const kind = c.req.query('kind')
  const conds = []
  if (userId) conds.push(eq(segments.user_id, userId))
  if (kind) conds.push(eq(segments.kind, kind))
  const rows = conds.length
    ? await db
        .select()
        .from(segments)
        .where(conds.length === 1 ? conds[0] : and(...conds))
        .orderBy(desc(segments.created_at))
    : await db.select().from(segments).orderBy(desc(segments.created_at))
  return c.json(rows)
})

// Auth: create control/segment definition
router.post('/', authMiddleware, zValidator('json', segmentSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [segment] = await db
    .insert(segments)
    .values({
      user_id: userId,
      name: body.name,
      kind: body.kind ?? 'control',
      criteria: (body.criteria ?? {}) as Record<string, unknown>,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'create',
    entity: 'segment',
    entity_id: segment.id,
    detail: { name: segment.name, kind: segment.kind },
  })

  return c.json(segment, 201)
})

// Auth: update segment
router.put('/:id', authMiddleware, zValidator('json', segmentSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(segments).where(eq(segments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.kind !== undefined) patch.kind = body.kind
  if (body.criteria !== undefined) patch.criteria = body.criteria

  const [updated] = await db.update(segments).set(patch).where(eq(segments.id, id)).returning()
  return c.json(updated)
})

// Auth: delete segment
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(segments).where(eq(segments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(segments).where(eq(segments.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'segment',
    entity_id: id,
    detail: {},
  })
  return c.json({ success: true })
})

export default router
