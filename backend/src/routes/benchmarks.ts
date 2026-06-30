import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { benchmarks, promo_pnl, promos, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const benchmarkSchema = z.object({
  scope: z.enum(['promo', 'collection', 'global']).default('promo'),
  scope_id: z.string().nullable().optional(),
  label: z.string().min(1),
  target_margin_pct: z.number().default(0),
  target_contribution_cents: z.number().int().default(0),
})

// ---------------------------------------------------------------------------
// GET / — public — list benchmarks (optional ?user_id, ?scope filters)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId =
    c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const scope = c.req.query('scope')
  const conds = []
  if (userId) conds.push(eq(benchmarks.user_id, userId))
  if (scope) conds.push(eq(benchmarks.scope, scope))
  const rows = conds.length
    ? await db
        .select()
        .from(benchmarks)
        .where(conds.length === 1 ? conds[0] : and(...conds))
        .orderBy(benchmarks.created_at)
    : await db.select().from(benchmarks).orderBy(benchmarks.created_at)
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /variance — public — benchmark vs realized variance
//
// For each promo-scoped benchmark, compare the target margin/contribution
// against the promo's realized P&L. Variance is realized - target (positive
// = beating the target). For global/collection benchmarks the realized
// figure is the aggregate across the matching promos.
// ---------------------------------------------------------------------------
router.get('/variance', async (c) => {
  const userId =
    c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')

  const benchConds = userId ? [eq(benchmarks.user_id, userId)] : []
  const benchRows = benchConds.length
    ? await db.select().from(benchmarks).where(benchConds[0])
    : await db.select().from(benchmarks)

  // Pull all P&L (scoped to user if known) plus promos for collection mapping.
  const pnlRows = userId
    ? await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))
    : await db.select().from(promo_pnl)
  const promoRows = userId
    ? await db.select().from(promos).where(eq(promos.user_id, userId))
    : await db.select().from(promos)

  const pnlByPromo = new Map(pnlRows.map((p) => [p.promo_id, p]))
  const promoById = new Map(promoRows.map((p) => [p.id, p]))

  const rows = benchRows.map((b) => {
    let actualContribution = 0
    let actualMargin = 0

    if (b.scope === 'promo' && b.scope_id) {
      const p = pnlByPromo.get(b.scope_id)
      actualContribution = p?.contribution_cents ?? 0
      actualMargin = p?.realized_margin_pct ?? 0
    } else {
      // collection or global: aggregate matching promos' P&L.
      let netRevenue = 0
      let contribution = 0
      for (const p of pnlRows) {
        if (b.scope === 'collection' && b.scope_id) {
          // match promos whose eligible_skus belong to the collection is not
          // resolvable here, so fall back to matching on campaign_tag/owner is
          // out of scope; use all promos that share the scope_id via promo id.
          const promo = promoById.get(p.promo_id)
          if (!promo) continue
          // collection benchmarks key off the promo's recorded collection in
          // notes/campaign_tag is unavailable; treat scope_id as a campaign tag.
          if (promo.campaign_tag !== b.scope_id) continue
        }
        netRevenue += p.net_revenue_cents
        contribution += p.contribution_cents
      }
      actualContribution = contribution
      actualMargin = netRevenue > 0 ? (contribution / netRevenue) * 100 : 0
    }

    return {
      scope_id: b.scope_id ?? b.scope,
      label: b.label,
      scope: b.scope,
      target_margin_pct: b.target_margin_pct,
      target_contribution_cents: b.target_contribution_cents,
      actual_margin_pct: actualMargin,
      actual_contribution_cents: actualContribution,
      target: b.target_contribution_cents,
      actual: actualContribution,
      variance: actualContribution - b.target_contribution_cents,
      margin_variance_pct: actualMargin - b.target_margin_pct,
    }
  })

  return c.json({ rows })
})

// ---------------------------------------------------------------------------
// POST / — auth — create a benchmark/target
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', benchmarkSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(benchmarks)
    .values({
      user_id: userId,
      scope: body.scope,
      scope_id: body.scope_id ?? null,
      label: body.label,
      target_margin_pct: body.target_margin_pct,
      target_contribution_cents: body.target_contribution_cents,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'create',
    entity: 'benchmark',
    entity_id: row.id,
    detail: { label: row.label, scope: row.scope },
  })

  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth — update a benchmark (ownership-checked)
// ---------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', benchmarkSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(benchmarks).where(eq(benchmarks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.scope !== undefined) patch.scope = body.scope
  if (body.scope_id !== undefined) patch.scope_id = body.scope_id
  if (body.label !== undefined) patch.label = body.label
  if (body.target_margin_pct !== undefined) patch.target_margin_pct = body.target_margin_pct
  if (body.target_contribution_cents !== undefined)
    patch.target_contribution_cents = body.target_contribution_cents

  const [updated] = await db
    .update(benchmarks)
    .set(patch)
    .where(eq(benchmarks.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete a benchmark (ownership-checked)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(benchmarks).where(eq(benchmarks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(benchmarks).where(eq(benchmarks.id, id))
  return c.json({ success: true })
})

export default router
