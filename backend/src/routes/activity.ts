import { Hono } from 'hono'
import { eq, and, desc, type SQL } from 'drizzle-orm'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — Public — audit / activity-log feed (newest first).
// Filters: ?entity, ?entity_id, ?limit, plus optional ?user_id / X-User-Id.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const entity = c.req.query('entity')
  const entityId = c.req.query('entity_id')
  const limitRaw = parseInt(c.req.query('limit') ?? '100', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100

  const filters: SQL[] = []
  if (userId) filters.push(eq(activity_log.user_id, userId))
  if (entity) filters.push(eq(activity_log.entity, entity))
  if (entityId) filters.push(eq(activity_log.entity_id, entityId))

  const rows = await db
    .select()
    .from(activity_log)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(activity_log.created_at))
    .limit(limit)

  return c.json(rows)
})

export default router
