import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  promos,
  promo_pnl,
  promo_alerts,
  cannibalization_results,
} from '../db/schema.js'

const router = new Hono()

function resolveUserId(c: any): string | undefined {
  return c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
}

// ---------------------------------------------------------------------------
// GET /overview — public — portfolio KPIs
//   - promo_count            : promos for the user
//   - analyzed_count         : promos with a computed P&L
//   - total_contribution     : sum of realized contribution across P&L
//   - total_net_revenue      : sum of net revenue
//   - dollars_destroyed      : sum of |contribution| for money-losing promos
//   - recoverable            : recoverable contribution from open alerts
//   - portfolio_margin_pct   : contribution / net revenue
// ---------------------------------------------------------------------------
router.get('/overview', async (c) => {
  const userId = resolveUserId(c)

  const promoRows = userId
    ? await db.select().from(promos).where(eq(promos.user_id, userId))
    : await db.select().from(promos)
  const pnlRows = userId
    ? await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))
    : await db.select().from(promo_pnl)
  const alertRows = userId
    ? await db
        .select()
        .from(promo_alerts)
        .where(and(eq(promo_alerts.user_id, userId), eq(promo_alerts.status, 'open')))
    : await db.select().from(promo_alerts).where(eq(promo_alerts.status, 'open'))

  let totalContribution = 0
  let totalNetRevenue = 0
  let totalDiscount = 0
  let dollarsDestroyed = 0
  let losingCount = 0
  for (const p of pnlRows) {
    totalContribution += p.contribution_cents
    totalNetRevenue += p.net_revenue_cents
    totalDiscount += p.discount_cents
    if (p.contribution_cents < 0) {
      dollarsDestroyed += Math.abs(p.contribution_cents)
      losingCount += 1
    }
  }

  let recoverable = 0
  for (const a of alertRows) recoverable += Math.abs(a.dollars_destroyed_cents)

  const kpis = {
    promo_count: promoRows.length,
    analyzed_count: pnlRows.length,
    losing_count: losingCount,
    open_alert_count: alertRows.length,
    total_contribution_cents: totalContribution,
    total_net_revenue_cents: totalNetRevenue,
    total_discount_cents: totalDiscount,
    dollars_destroyed_cents: dollarsDestroyed,
    recoverable_cents: recoverable,
    portfolio_margin_pct:
      totalNetRevenue > 0 ? (totalContribution / totalNetRevenue) * 100 : 0,
  }

  return c.json({ kpis })
})

// ---------------------------------------------------------------------------
// GET /leaderboard — public — top winners / top losers by contribution
// ---------------------------------------------------------------------------
router.get('/leaderboard', async (c) => {
  const userId = resolveUserId(c)
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '5', 10) || 5, 50))

  const pnlRows = userId
    ? await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))
    : await db.select().from(promo_pnl)
  const promoRows = userId
    ? await db.select().from(promos).where(eq(promos.user_id, userId))
    : await db.select().from(promos)
  const promoById = new Map(promoRows.map((p) => [p.id, p]))

  const enriched = pnlRows.map((p) => {
    const promo = promoById.get(p.promo_id)
    return {
      promo_id: p.promo_id,
      name: promo?.name ?? 'Unknown promo',
      promo_type: promo?.promo_type ?? null,
      discount_depth_pct: promo?.discount_depth_pct ?? null,
      contribution_cents: p.contribution_cents,
      realized_margin_pct: p.realized_margin_pct,
      net_revenue_cents: p.net_revenue_cents,
      units: p.units,
    }
  })

  const sortedDesc = [...enriched].sort(
    (a, b) => b.contribution_cents - a.contribution_cents,
  )
  const winners = sortedDesc.slice(0, limit)
  const losers = [...enriched]
    .sort((a, b) => a.contribution_cents - b.contribution_cents)
    .filter((r) => r.contribution_cents < 0 || sortedDesc.indexOf(r) >= sortedDesc.length - limit)
    .slice(0, limit)

  return c.json({ winners, losers })
})

// ---------------------------------------------------------------------------
// GET /margin-trend — public — realized-margin trend across promos by end_at
// ---------------------------------------------------------------------------
router.get('/margin-trend', async (c) => {
  const userId = resolveUserId(c)

  const pnlRows = userId
    ? await db.select().from(promo_pnl).where(eq(promo_pnl.user_id, userId))
    : await db.select().from(promo_pnl)
  const promoRows = userId
    ? await db.select().from(promos).where(eq(promos.user_id, userId))
    : await db.select().from(promos)
  const promoById = new Map(promoRows.map((p) => [p.id, p]))

  const points = pnlRows
    .map((p) => {
      const promo = promoById.get(p.promo_id)
      return {
        promo_id: p.promo_id,
        name: promo?.name ?? 'Unknown promo',
        end_at: promo?.end_at ?? null,
        realized_margin_pct: p.realized_margin_pct,
        list_margin_pct: p.list_margin_pct,
        contribution_cents: p.contribution_cents,
        net_revenue_cents: p.net_revenue_cents,
      }
    })
    .filter((pt) => pt.end_at !== null)
    .sort((a, b) => {
      const ta = a.end_at ? new Date(a.end_at as unknown as string).getTime() : 0
      const tb = b.end_at ? new Date(b.end_at as unknown as string).getTime() : 0
      return ta - tb
    })

  return c.json({ points })
})

export default router
