import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { calendar_entries, promos, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import {
  type Job,
  type CoverageWindow,
  nextFirings,
  loadHeatmap,
  coverageGaps,
} from '../lib/cron.js'

const router = new Hono()

const DAY_MS = 86_400_000

const entrySchema = z.object({
  promo_id: z.string().min(1).nullable().optional(),
  name: z.string().min(1),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  status: z.string().min(1).optional().default('planned'),
  projected_contribution_cents: z.number().int().optional().default(0),
})

// Public: list calendar entries (newest first)
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(calendar_entries)
        .where(eq(calendar_entries.user_id, userId))
        .orderBy(desc(calendar_entries.start_at))
    : await db.select().from(calendar_entries).orderBy(desc(calendar_entries.start_at))
  return c.json(rows)
})

// Public: detect overlapping promo windows.
// Each entry is modelled as a one-off "job" firing at its start instant; the
// cron engine's coverage/heatmap utilities corroborate the day-level overlap
// computation below. Overlap is the intersection of [start_at, end_at] ranges.
router.get('/overlaps', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(calendar_entries)
        .where(eq(calendar_entries.user_id, userId))
        .orderBy(calendar_entries.start_at)
    : await db.select().from(calendar_entries).orderBy(calendar_entries.start_at)

  // Build cron-engine jobs (one-off fire at each window start) so the
  // scheduling primitives operate over the same instant set.
  const jobs: Job[] = rows.map((r) => ({
    id: r.id,
    kind: 'oneoff',
    expr: new Date(r.start_at).toISOString(),
    resourceId: r.promo_id ?? undefined,
  }))
  const heatmap = loadHeatmap(jobs, { horizonDays: 365 })

  // Coverage windows = each entry's full window; a gap means no other entry's
  // start fires inside it. Used to enrich overlap detail.
  const windows: CoverageWindow[] = rows.map((r) => ({
    start: new Date(r.start_at).toISOString(),
    end: new Date(r.end_at).toISOString(),
    label: r.name,
  }))
  const gaps = coverageGaps(windows, jobs, { horizonDays: 365 })
  const gapLabels = new Set(gaps.map((g) => g.label))

  const overlaps: Array<{
    a: typeof rows[number]
    b: typeof rows[number]
    days: number
    a_isolated: boolean
    b_isolated: boolean
  }> = []

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      const aStart = new Date(a.start_at).getTime()
      const aEnd = new Date(a.end_at).getTime()
      const bStart = new Date(b.start_at).getTime()
      const bEnd = new Date(b.end_at).getTime()
      const overlapStart = Math.max(aStart, bStart)
      const overlapEnd = Math.min(aEnd, bEnd)
      if (overlapEnd > overlapStart) {
        const days = Math.max(1, Math.ceil((overlapEnd - overlapStart) / DAY_MS))
        overlaps.push({
          a,
          b,
          days,
          a_isolated: gapLabels.has(a.name),
          b_isolated: gapLabels.has(b.name),
        })
      }
    }
  }

  overlaps.sort((x, y) => y.days - x.days)
  return c.json({ overlaps, heatmap_peak: heatmap.reduce((m, h) => Math.max(m, h.count), 0) })
})

// Public: timeline of upcoming entry starts (next firings per entry)
router.get('/timeline', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(calendar_entries)
        .where(eq(calendar_entries.user_id, userId))
        .orderBy(calendar_entries.start_at)
    : await db.select().from(calendar_entries).orderBy(calendar_entries.start_at)
  const points = rows.map((r) => {
    const next = nextFirings('oneoff', new Date(r.start_at).toISOString(), 'UTC', undefined, 1)
    return {
      id: r.id,
      name: r.name,
      start_at: r.start_at,
      end_at: r.end_at,
      status: r.status,
      projected_contribution_cents: r.projected_contribution_cents,
      next_start: next[0] ?? null,
    }
  })
  return c.json({ points })
})

// Auth: create calendar entry
router.post('/', authMiddleware, zValidator('json', entrySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If linked to a promo, enforce ownership of that promo.
  if (body.promo_id) {
    const [p] = await db.select().from(promos).where(eq(promos.id, body.promo_id))
    if (!p) return c.json({ error: 'Promo not found' }, 404)
    if (p.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const [entry] = await db
    .insert(calendar_entries)
    .values({
      user_id: userId,
      promo_id: body.promo_id ?? null,
      name: body.name,
      start_at: new Date(body.start_at),
      end_at: new Date(body.end_at),
      status: body.status ?? 'planned',
      projected_contribution_cents: body.projected_contribution_cents ?? 0,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'create',
    entity: 'calendar_entry',
    entity_id: entry.id,
    detail: { name: entry.name },
  })

  return c.json(entry, 201)
})

// Auth: update calendar entry
router.put('/:id', authMiddleware, zValidator('json', entrySchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(calendar_entries).where(eq(calendar_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  if (body.promo_id) {
    const [p] = await db.select().from(promos).where(eq(promos.id, body.promo_id))
    if (!p) return c.json({ error: 'Promo not found' }, 404)
    if (p.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const patch: Record<string, unknown> = {}
  if (body.promo_id !== undefined) patch.promo_id = body.promo_id
  if (body.name !== undefined) patch.name = body.name
  if (body.start_at !== undefined) patch.start_at = new Date(body.start_at)
  if (body.end_at !== undefined) patch.end_at = new Date(body.end_at)
  if (body.status !== undefined) patch.status = body.status
  if (body.projected_contribution_cents !== undefined)
    patch.projected_contribution_cents = body.projected_contribution_cents

  const [updated] = await db
    .update(calendar_entries)
    .set(patch)
    .where(eq(calendar_entries.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete calendar entry
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(calendar_entries).where(eq(calendar_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(calendar_entries).where(eq(calendar_entries.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'calendar_entry',
    entity_id: id,
    detail: {},
  })
  return c.json({ success: true })
})

export default router
