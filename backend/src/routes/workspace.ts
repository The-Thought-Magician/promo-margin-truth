import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Load the caller's workspace, creating one with sane defaults if absent.
async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ user_id: userId })
    .returning()
  return created
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).max(8).optional(),
  platform_fee_pct: z.number().min(0).max(100).optional(),
  pre_period_days: z.number().int().min(1).max(365).optional(),
  pull_forward_days: z.number().int().min(0).max(365).optional(),
  flag_min_contribution_cents: z.number().int().optional(),
  flag_min_margin_pct: z.number().optional(),
})

// GET / — auth — current user's workspace (auto-create defaults)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspace = await getOrCreateWorkspace(userId)
  return c.json({ workspace })
})

// PUT / — auth — update workspace config
router.put('/', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  // Ensure the workspace exists before updating.
  await getOrCreateWorkspace(userId)
  const [workspace] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.user_id, userId))
    .returning()
  return c.json({ workspace })
})

export default router
