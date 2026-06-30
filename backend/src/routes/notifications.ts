import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — Public — list a user's notifications (newest first).
// Reads user_id from ?user_id or the X-User-Id header.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /:id/read — Auth — mark a single notification read (ownership-checked)
// ---------------------------------------------------------------------------
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /read-all — Auth — mark all of the user's notifications read
// ---------------------------------------------------------------------------
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)))
  return c.json({ success: true })
})

export default router
