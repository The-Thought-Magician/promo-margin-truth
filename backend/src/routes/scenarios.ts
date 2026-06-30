import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  scenarios,
  promos,
  promo_pnl,
  elasticity_curves,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Projection helper: project net contribution at a given discount depth using a
// fitted elasticity curve (units respond to depth via coefficient), falling back
// to the base promo's realized P&L when no curve is fitted.
// ---------------------------------------------------------------------------

interface ProjectionInput {
  userId: string
  basePromoId?: string | null
  depthPct: number
  scope?: string
  scopeId?: string | null
}

async function projectContributionCents(input: ProjectionInput): Promise<number> {
  const { userId, basePromoId, depthPct } = input

  // Try to resolve a fitted elasticity curve for the requested scope, falling
  // back to the global curve for the user.
  const scope = input.scope ?? (basePromoId ? 'promo' : 'global')
  const scopeId = input.scopeId ?? (basePromoId ?? 'global')

  let curve =
    (
      await db
        .select()
        .from(elasticity_curves)
        .where(
          and(
            eq(elasticity_curves.user_id, userId),
            eq(elasticity_curves.scope, scope),
            eq(elasticity_curves.scope_id, scopeId),
          ),
        )
    )[0] ?? null

  if (!curve) {
    curve =
      (
        await db
          .select()
          .from(elasticity_curves)
          .where(
            and(
              eq(elasticity_curves.user_id, userId),
              eq(elasticity_curves.scope, 'global'),
              eq(elasticity_curves.scope_id, 'global'),
            ),
          )
      )[0] ?? null
  }

  // Establish a baseline contribution + margin from the base promo's P&L.
  let baseContribution = 0
  let baseNetRevenue = 0
  let baseUnits = 0
  let baseDepth = 0
  let realizedMargin = 0

  if (basePromoId) {
    const [pnl] = await db
      .select()
      .from(promo_pnl)
      .where(eq(promo_pnl.promo_id, basePromoId))
    const [promo] = await db.select().from(promos).where(eq(promos.id, basePromoId))
    if (pnl) {
      baseContribution = pnl.contribution_cents
      baseNetRevenue = pnl.net_revenue_cents
      baseUnits = pnl.units
      realizedMargin = pnl.realized_margin_pct
    }
    if (promo) baseDepth = promo.discount_depth_pct
  }

  // If we have a fitted curve, prefer evaluating its model. The curve stores a
  // coefficient describing unit lift per percentage point of depth and a set of
  // sampled curve points; interpolate the points when available.
  if (curve && Array.isArray(curve.curve_points) && curve.curve_points.length > 0) {
    const pts = [...curve.curve_points].sort((a, b) => a.depth - b.depth)
    // exact match
    const exact = pts.find((p) => Math.abs(p.depth - depthPct) < 1e-9)
    if (exact) return Math.round(exact.contribution_cents)
    // clamp / interpolate
    if (depthPct <= pts[0].depth) return Math.round(pts[0].contribution_cents)
    if (depthPct >= pts[pts.length - 1].depth)
      return Math.round(pts[pts.length - 1].contribution_cents)
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i]
      const hi = pts[i + 1]
      if (depthPct >= lo.depth && depthPct <= hi.depth) {
        const span = hi.depth - lo.depth
        const frac = span === 0 ? 0 : (depthPct - lo.depth) / span
        return Math.round(
          lo.contribution_cents + frac * (hi.contribution_cents - lo.contribution_cents),
        )
      }
    }
  }

  // Model-based fallback using the fitted coefficient. Units scale with depth via
  // the coefficient (interpreted as fractional unit lift per percentage point of
  // additional depth relative to the base). Contribution = units * per-unit margin
  // minus the incremental discount cost.
  if (basePromoId && baseUnits > 0) {
    const perUnitMargin = baseContribution / baseUnits
    const perUnitNet = baseNetRevenue / baseUnits
    const coeff = curve ? curve.coefficient : -0.5
    const deltaDepth = depthPct - baseDepth
    // unit multiplier: deeper discount lifts units (coeff typically negative for
    // price elasticity, so a negative coeff with positive deltaDepth raises units)
    const unitMultiplier = Math.max(0, 1 + Math.abs(coeff) * (deltaDepth / 100))
    const projectedUnits = baseUnits * unitMultiplier
    // per-unit net revenue shrinks as depth deepens relative to base
    const grossPerUnit = baseDepth >= 100 ? perUnitNet : perUnitNet / (1 - baseDepth / 100)
    const newPerUnitNet = grossPerUnit * (1 - depthPct / 100)
    const perUnitCogs = perUnitNet - perUnitMargin // cogs + fee component per unit
    const newPerUnitContribution = newPerUnitNet - perUnitCogs
    return Math.round(projectedUnits * newPerUnitContribution)
  }

  // Last resort: scale base contribution down proportionally to extra depth.
  if (baseContribution !== 0) {
    const factor = Math.max(0, 1 - Math.max(0, depthPct - baseDepth) / 100)
    return Math.round(baseContribution * factor)
  }

  // With no base data, use realized margin assumption against a nominal revenue.
  void realizedMargin
  return 0
}

const paramsSchema = z
  .object({
    depth_pct: z.number().min(0).max(100).optional(),
    scope: z.string().optional(),
    scope_id: z.string().nullable().optional(),
  })
  .passthrough()

const scenarioCreateSchema = z.object({
  name: z.string().min(1),
  base_promo_id: z.string().nullable().optional(),
  params: paramsSchema.optional().default({}),
})

const scenarioUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  base_promo_id: z.string().nullable().optional(),
  params: paramsSchema.optional(),
})

function depthFromParams(params: Record<string, unknown> | undefined): number {
  if (!params) return 0
  const d = params['depth_pct']
  if (typeof d === 'number' && Number.isFinite(d)) return d
  if (typeof d === 'string' && d.trim() !== '' && Number.isFinite(Number(d))) return Number(d)
  return 0
}

// Public: list scenarios for a user (defaults to header user when present)
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.user_id, userId))
    .orderBy(desc(scenarios.created_at))
  return c.json(rows)
})

// Public: one scenario
router.get('/:id', async (c) => {
  const [row] = await db.select().from(scenarios).where(eq(scenarios.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Auth: create scenario, auto-projecting net contribution via elasticity
router.post('/', authMiddleware, zValidator('json', scenarioCreateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const params = (body.params ?? {}) as Record<string, unknown>
  const depthPct = depthFromParams(params)

  const projected = await projectContributionCents({
    userId,
    basePromoId: body.base_promo_id ?? null,
    depthPct,
    scope: typeof params['scope'] === 'string' ? (params['scope'] as string) : undefined,
    scopeId:
      typeof params['scope_id'] === 'string' ? (params['scope_id'] as string) : undefined,
  })

  const [row] = await db
    .insert(scenarios)
    .values({
      user_id: userId,
      name: body.name,
      base_promo_id: body.base_promo_id ?? null,
      params,
      projected_contribution_cents: projected,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'create',
    entity: 'scenario',
    entity_id: row.id,
    detail: { name: row.name, projected_contribution_cents: projected },
  })

  return c.json(row, 201)
})

// Auth: update scenario, re-projecting contribution
router.put('/:id', authMiddleware, zValidator('json', scenarioUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const params = (body.params ?? existing.params ?? {}) as Record<string, unknown>
  const basePromoId =
    body.base_promo_id !== undefined ? body.base_promo_id : existing.base_promo_id
  const depthPct = depthFromParams(params)

  const projected = await projectContributionCents({
    userId,
    basePromoId: basePromoId ?? null,
    depthPct,
    scope: typeof params['scope'] === 'string' ? (params['scope'] as string) : undefined,
    scopeId:
      typeof params['scope_id'] === 'string' ? (params['scope_id'] as string) : undefined,
  })

  const [updated] = await db
    .update(scenarios)
    .set({
      name: body.name ?? existing.name,
      base_promo_id: basePromoId ?? null,
      params,
      projected_contribution_cents: projected,
      updated_at: new Date(),
    })
    .where(eq(scenarios.id, id))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'update',
    entity: 'scenario',
    entity_id: id,
    detail: { projected_contribution_cents: projected },
  })

  return c.json(updated)
})

// Auth: delete scenario
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(scenarios).where(eq(scenarios.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'scenario',
    entity_id: id,
    detail: {},
  })
  return c.json({ success: true })
})

export default router
