import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  channel_stats,
  order_lines,
  promos,
  promo_pnl,
  cannibalization_results,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /:promoId — public — per-channel stats for a promo
// ---------------------------------------------------------------------------
router.get('/:promoId', async (c) => {
  const promoId = c.req.param('promoId')
  const rows = await db
    .select()
    .from(channel_stats)
    .where(eq(channel_stats.promo_id, promoId))
    .orderBy(channel_stats.channel)
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /:promoId/compute — auth — compute per-channel attribution & upsert
//
// For each channel observed in this promo's order_lines we compute:
//   revenue_cents                  = sum(unit_price*qty - discount)  (net)
//   incremental_contribution_cents = channel share of the promo's net
//                                     contribution (after the
//                                     cannibalization adjustment, if any)
//   mix_pct                        = channel net revenue / total net revenue
// ---------------------------------------------------------------------------
router.post('/:promoId/compute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const promoId = c.req.param('promoId')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promoId))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const lines = await db
    .select()
    .from(order_lines)
    .where(and(eq(order_lines.user_id, userId), eq(order_lines.promo_id, promoId)))

  // Aggregate per channel.
  interface Agg {
    channel: string
    revenue_cents: number
    cogs_cents: number
    units: number
  }
  const byChannel = new Map<string, Agg>()
  let totalNet = 0
  for (const l of lines) {
    const channel = l.channel && l.channel.trim() ? l.channel : 'unknown'
    const gross = l.unit_price_cents * l.qty
    const net = gross - l.discount_amount_cents
    const cogs = l.cogs_unit_cents * l.qty
    totalNet += net
    const a = byChannel.get(channel) ?? {
      channel,
      revenue_cents: 0,
      cogs_cents: 0,
      units: 0,
    }
    a.revenue_cents += net
    a.cogs_cents += cogs
    a.units += l.qty
    byChannel.set(channel, a)
  }

  // Net contribution for the whole promo: prefer the computed P&L
  // contribution (already net of platform fees), then subtract any
  // cannibalization dollar adjustment so "incremental" is honest.
  const [pnl] = await db
    .select()
    .from(promo_pnl)
    .where(eq(promo_pnl.promo_id, promoId))
  const [cann] = await db
    .select()
    .from(cannibalization_results)
    .where(eq(cannibalization_results.promo_id, promoId))

  let promoContribution: number
  if (pnl) {
    promoContribution = pnl.contribution_cents
  } else {
    // fall back to a raw net-revenue-minus-COGS figure
    let raw = 0
    for (const a of byChannel.values()) raw += a.revenue_cents - a.cogs_cents
    promoContribution = raw
  }
  if (cann) promoContribution -= cann.dollar_adjustment_cents

  // Upsert one row per channel; replace stale channels for a clean snapshot.
  await db.delete(channel_stats).where(eq(channel_stats.promo_id, promoId))

  const stats = []
  for (const a of byChannel.values()) {
    const mix = totalNet > 0 ? a.revenue_cents / totalNet : 0
    const incremental = Math.round(promoContribution * mix)
    const [row] = await db
      .insert(channel_stats)
      .values({
        user_id: userId,
        promo_id: promoId,
        channel: a.channel,
        revenue_cents: a.revenue_cents,
        incremental_contribution_cents: incremental,
        mix_pct: mix,
      })
      .returning()
    stats.push(row)
  }

  stats.sort((x, y) => y.revenue_cents - x.revenue_cents)

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'compute',
    entity: 'channel_stats',
    entity_id: promoId,
    detail: { channels: stats.length, total_net_cents: totalNet },
  })

  return c.json({ stats }, 201)
})

export default router
