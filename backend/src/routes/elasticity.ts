import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  promos,
  promo_pnl,
  elasticity_curves,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Curve model
//
// We model net contribution as a function of discount depth d (in percent):
//
//   contribution(d) = base * (1 + coefficient * d) * (1 - d/100)
//
// where `base` is the at-zero-depth contribution proxy (units * margin per
// unit at list) and `coefficient` is the demand-lift elasticity per point of
// depth, fit by least squares from observed promos (depth -> contribution).
//
// The optimal depth is found by sampling 0..80% and taking the argmax of the
// modelled contribution. All money is integer cents.
// ---------------------------------------------------------------------------

interface Observation {
  depth: number // percent
  contribution: number // cents
  base: number // at-list contribution proxy, cents
}

function fitCoefficient(obs: Observation[]): { coefficient: number; base: number } {
  // Average per-promo base as the no-discount reference.
  const bases = obs.map((o) => o.base).filter((b) => b > 0)
  const base = bases.length ? bases.reduce((a, b) => a + b, 0) / bases.length : 0

  // For each observation, the realized multiplier m = contribution / (base * (1 - d/100)).
  // Then m = 1 + coefficient * d  =>  coefficient = (m - 1) / d. Least-squares
  // through observations with d > 0.
  let sumXX = 0
  let sumXY = 0
  for (const o of obs) {
    if (o.depth <= 0 || base <= 0) continue
    const priceFactor = 1 - o.depth / 100
    if (priceFactor <= 0) continue
    const m = o.contribution / (base * priceFactor)
    const y = m - 1 // expected to equal coefficient * depth
    const x = o.depth
    sumXX += x * x
    sumXY += x * y
  }
  const coefficient = sumXX > 0 ? sumXY / sumXX : 0
  return { coefficient, base }
}

function modelContribution(base: number, coefficient: number, depth: number): number {
  const priceFactor = 1 - depth / 100
  const liftFactor = 1 + coefficient * depth
  return Math.round(base * liftFactor * priceFactor)
}

function buildCurve(base: number, coefficient: number) {
  const points: Array<{ depth: number; contribution_cents: number }> = []
  let optimalDepth = 0
  let optimalContribution = modelContribution(base, coefficient, 0)
  for (let d = 0; d <= 80; d += 5) {
    const contribution = modelContribution(base, coefficient, d)
    points.push({ depth: d, contribution_cents: contribution })
    if (contribution > optimalContribution) {
      optimalContribution = contribution
      optimalDepth = d
    }
  }
  return { points, optimalDepth, optimalContribution }
}

// Collect (depth, contribution, base) observations for a scope from promos +
// their computed P&L. scope = 'global' aggregates all promos; scope = 'promo'
// uses a single promo; scope = 'campaign' filters by campaign_tag.
async function gatherObservations(
  userId: string,
  scope: string,
  scopeId: string | null,
): Promise<Observation[]> {
  const userPromos = await db.select().from(promos).where(eq(promos.user_id, userId))
  let selected = userPromos
  if (scope === 'promo' && scopeId) {
    selected = userPromos.filter((p) => p.id === scopeId)
  } else if (scope === 'campaign' && scopeId) {
    selected = userPromos.filter((p) => p.campaign_tag === scopeId)
  } else if (scope === 'collection' && scopeId) {
    // collection scope: promos whose eligible_skus overlap is not tracked here;
    // fall back to campaign_tag match if provided, else all.
    selected = userPromos.filter((p) => p.campaign_tag === scopeId)
  }

  const obs: Observation[] = []
  for (const p of selected) {
    const [pnl] = await db.select().from(promo_pnl).where(eq(promo_pnl.promo_id, p.id))
    if (!pnl) continue
    // base = the contribution this promo WOULD have produced at zero discount:
    // net at list (gross_revenue) - cogs - platform_fee, i.e. add the discount
    // back. This is the no-promo reference contribution.
    const base =
      pnl.gross_revenue_cents - pnl.cogs_cents - pnl.platform_fee_cents
    obs.push({
      depth: p.discount_depth_pct,
      contribution: pnl.contribution_cents,
      base,
    })
  }
  return obs
}

// ---------------------------------------------------------------------------
// GET / — Public — list fitted curves
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.query('user_id')
  const rows = userId
    ? await db
        .select()
        .from(elasticity_curves)
        .where(eq(elasticity_curves.user_id, userId))
        .orderBy(desc(elasticity_curves.computed_at))
    : await db.select().from(elasticity_curves).orderBy(desc(elasticity_curves.computed_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:scope/:scopeId — Public — one fitted curve (scopeId may be 'global')
// ---------------------------------------------------------------------------
router.get('/:scope/:scopeId', async (c) => {
  const scope = c.req.param('scope')
  const scopeIdParam = c.req.param('scopeId')
  const scopeId = scopeIdParam === 'global' ? null : scopeIdParam
  const userId = c.req.query('user_id')

  const conds = [eq(elasticity_curves.scope, scope)]
  if (scopeId === null) {
    // match the global row (scope_id IS NULL) — drizzle eq with null won't work,
    // so filter in memory after scope+user narrowing.
  }
  if (userId) conds.push(eq(elasticity_curves.user_id, userId))

  const candidates = await db
    .select()
    .from(elasticity_curves)
    .where(conds.length === 1 ? conds[0] : and(...conds))

  const match = candidates.find((r) =>
    scopeId === null ? r.scope_id === null : r.scope_id === scopeId,
  )
  return c.json(match ?? null)
})

// ---------------------------------------------------------------------------
// POST /fit — Auth — fit a curve for a scope across promos & upsert
// ---------------------------------------------------------------------------
const fitSchema = z.object({
  scope: z.enum(['global', 'promo', 'campaign', 'collection']).default('global'),
  scope_id: z.string().nullable().optional(),
})

router.post('/fit', authMiddleware, zValidator('json', fitSchema), async (c) => {
  const userId = getUserId(c)
  const { scope } = c.req.valid('json')
  const scopeId = scope === 'global' ? null : c.req.valid('json').scope_id ?? null

  if (scope !== 'global' && !scopeId) {
    return c.json({ error: 'scope_id required for non-global scope' }, 400)
  }

  const obs = await gatherObservations(userId, scope, scopeId)
  if (obs.length === 0) {
    return c.json(
      { error: 'No computed P&L found for this scope; compute P&L on its promos first' },
      400,
    )
  }

  const { coefficient, base } = fitCoefficient(obs)
  const { points, optimalDepth, optimalContribution } = buildCurve(base, coefficient)

  // Upsert keyed on (user_id, scope, scope_id). Because the unique index
  // includes a nullable scope_id, we resolve an existing row manually for the
  // global (null) case and update/insert accordingly.
  const existingRows = await db
    .select()
    .from(elasticity_curves)
    .where(and(eq(elasticity_curves.user_id, userId), eq(elasticity_curves.scope, scope)))
  const existing = existingRows.find((r) =>
    scopeId === null ? r.scope_id === null : r.scope_id === scopeId,
  )

  const payload = {
    coefficient,
    optimal_depth_pct: optimalDepth,
    optimal_contribution_cents: optimalContribution,
    curve_points: points,
    computed_at: new Date(),
  }

  let row
  if (existing) {
    ;[row] = await db
      .update(elasticity_curves)
      .set(payload)
      .where(eq(elasticity_curves.id, existing.id))
      .returning()
  } else {
    ;[row] = await db
      .insert(elasticity_curves)
      .values({ user_id: userId, scope, scope_id: scopeId, ...payload })
      .returning()
  }

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'fit',
    entity: 'elasticity',
    entity_id: scopeId ?? 'global',
    detail: { scope, coefficient, optimal_depth_pct: optimalDepth },
  })

  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// POST /point — Auth — project net contribution at a given depth using the
// fitted curve for the scope (re-fitting if no stored curve exists).
// ---------------------------------------------------------------------------
const pointSchema = z.object({
  scope: z.enum(['global', 'promo', 'campaign', 'collection']).default('global'),
  scope_id: z.string().nullable().optional(),
  depth_pct: z.number().min(0).max(95),
})

router.post('/point', authMiddleware, zValidator('json', pointSchema), async (c) => {
  const userId = getUserId(c)
  const { scope, depth_pct } = c.req.valid('json')
  const scopeId = scope === 'global' ? null : c.req.valid('json').scope_id ?? null

  // Prefer a stored fitted curve; if absent, fit on the fly from observations.
  const storedRows = await db
    .select()
    .from(elasticity_curves)
    .where(and(eq(elasticity_curves.user_id, userId), eq(elasticity_curves.scope, scope)))
  const stored = storedRows.find((r) =>
    scopeId === null ? r.scope_id === null : r.scope_id === scopeId,
  )

  let coefficient: number
  let base: number
  if (stored) {
    coefficient = stored.coefficient
    // Recover base from the stored zero-depth point (contribution at d=0 == base).
    const zeroPoint = (stored.curve_points as Array<{ depth: number; contribution_cents: number }>).find(
      (p) => p.depth === 0,
    )
    base = zeroPoint ? zeroPoint.contribution_cents : 0
  } else {
    const obs = await gatherObservations(userId, scope, scopeId)
    if (obs.length === 0) {
      return c.json(
        { error: 'No fitted curve and no computed P&L for this scope' },
        400,
      )
    }
    const fit = fitCoefficient(obs)
    coefficient = fit.coefficient
    base = fit.base
  }

  const contributionCents = modelContribution(base, coefficient, depth_pct)
  return c.json({ depth_pct, contribution_cents: contributionCents })
})

export default router
