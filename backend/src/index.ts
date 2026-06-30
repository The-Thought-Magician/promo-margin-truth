import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  skus,
  promos,
  ingestion_runs,
  order_lines,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspaceRoutes from './routes/workspace.js'
import skusRoutes from './routes/skus.js'
import cogsRoutes from './routes/cogs.js'
import promosRoutes from './routes/promos.js'
import ingestRoutes from './routes/ingest.js'
import ordersRoutes from './routes/orders.js'
import mappingsRoutes from './routes/mappings.js'
import pnlRoutes from './routes/pnl.js'
import incrementalityRoutes from './routes/incrementality.js'
import cannibalizationRoutes from './routes/cannibalization.js'
import splitsRoutes from './routes/splits.js'
import elasticityRoutes from './routes/elasticity.js'
import scenariosRoutes from './routes/scenarios.js'
import alertsRoutes from './routes/alerts.js'
import retrospectiveRoutes from './routes/retrospective.js'
import calendarRoutes from './routes/calendar.js'
import cohortsRoutes from './routes/cohorts.js'
import segmentsRoutes from './routes/segments.js'
import channelsRoutes from './routes/channels.js'
import benchmarksRoutes from './routes/benchmarks.js'
import dashboardRoutes from './routes/dashboard.js'
import reportsRoutes from './routes/reports.js'
import notificationsRoutes from './routes/notifications.js'
import activityRoutes from './routes/activity.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://promo-margin-truth.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspace', workspaceRoutes)
api.route('/skus', skusRoutes)
api.route('/cogs', cogsRoutes)
api.route('/promos', promosRoutes)
api.route('/ingest', ingestRoutes)
api.route('/orders', ordersRoutes)
api.route('/mappings', mappingsRoutes)
api.route('/pnl', pnlRoutes)
api.route('/incrementality', incrementalityRoutes)
api.route('/cannibalization', cannibalizationRoutes)
api.route('/splits', splitsRoutes)
api.route('/elasticity', elasticityRoutes)
api.route('/scenarios', scenariosRoutes)
api.route('/alerts', alertsRoutes)
api.route('/retrospective', retrospectiveRoutes)
api.route('/calendar', calendarRoutes)
api.route('/cohorts', cohortsRoutes)
api.route('/segments', segmentsRoutes)
api.route('/channels', channelsRoutes)
api.route('/benchmarks', benchmarksRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/reports', reportsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/activity', activityRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Idempotent seed: plans (free/pro) + a small demo brand (one money-losing promo).
// ---------------------------------------------------------------------------

const DEMO_USER = 'demo-user'

async function seedIfEmpty() {
  // Plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  // Demo workspace
  const existingWs = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, DEMO_USER))
    .limit(1)
  if (existingWs.length > 0) return

  await db.insert(workspaces).values({
    user_id: DEMO_USER,
    name: 'Demo Brand',
    currency: 'USD',
    platform_fee_pct: 3,
    pre_period_days: 28,
    pull_forward_days: 14,
    flag_min_contribution_cents: 0,
    flag_min_margin_pct: 10,
  })

  await db.insert(skus).values([
    {
      user_id: DEMO_USER,
      sku_code: 'TEE-001',
      name: 'Classic Tee',
      collection: 'Apparel',
      list_price_cents: 3500,
      cogs_unit_cents: 1200,
    },
    {
      user_id: DEMO_USER,
      sku_code: 'HOODIE-001',
      name: 'Pullover Hoodie',
      collection: 'Apparel',
      list_price_cents: 8500,
      cogs_unit_cents: 4200,
    },
    {
      user_id: DEMO_USER,
      sku_code: 'MUG-001',
      name: 'Ceramic Mug',
      collection: 'Accessories',
      list_price_cents: 1800,
      cogs_unit_cents: 900,
    },
  ])

  const now = Date.now()
  const day = 86_400_000
  const [winnerPromo] = await db
    .insert(promos)
    .values({
      user_id: DEMO_USER,
      name: 'Spring Launch 15%',
      promo_type: 'sitewide_pct',
      discount_depth_pct: 15,
      start_at: new Date(now - 30 * day),
      end_at: new Date(now - 23 * day),
      status: 'analyzed',
      campaign_tag: 'spring-launch',
      channel_scope: ['email', 'paid'],
      eligible_skus: [],
      owner: 'Demo Marketer',
    })
    .returning()

  const [loserPromo] = await db
    .insert(promos)
    .values({
      user_id: DEMO_USER,
      name: 'Deep 50% Blowout',
      promo_type: 'sitewide_pct',
      discount_depth_pct: 50,
      start_at: new Date(now - 14 * day),
      end_at: new Date(now - 7 * day),
      status: 'analyzed',
      campaign_tag: 'blowout-50',
      channel_scope: ['email'],
      eligible_skus: [],
      owner: 'Demo Marketer',
    })
    .returning()

  const [run] = await db
    .insert(ingestion_runs)
    .values({
      user_id: DEMO_USER,
      filename: 'demo-orders.csv',
      source: 'sample',
      row_count: 0,
      error_count: 0,
      status: 'completed',
      summary: { note: 'Seeded demo brand' },
      errors: [],
    })
    .returning()

  const lines: Array<typeof order_lines.$inferInsert> = []
  // Winner promo: healthy margin at 15% off on the tee
  for (let i = 0; i < 40; i++) {
    lines.push({
      user_id: DEMO_USER,
      ingestion_run_id: run.id,
      promo_id: winnerPromo.id,
      order_id: `W-${i}`,
      sku_code: 'TEE-001',
      qty: 1,
      unit_price_cents: Math.round(3500 * 0.85),
      discount_amount_cents: Math.round(3500 * 0.15),
      cogs_unit_cents: 1200,
      customer_id: `cust-w-${i % 30}`,
      order_ts: new Date(now - (29 - (i % 7)) * day),
      campaign_tag: 'spring-launch',
      channel: i % 2 === 0 ? 'email' : 'paid',
      is_first_order: i % 3 === 0,
    })
  }
  // Loser promo: 50% off the hoodie destroys margin (price below cogs after fee)
  for (let i = 0; i < 50; i++) {
    lines.push({
      user_id: DEMO_USER,
      ingestion_run_id: run.id,
      promo_id: loserPromo.id,
      order_id: `L-${i}`,
      sku_code: 'HOODIE-001',
      qty: 1,
      unit_price_cents: Math.round(8500 * 0.5),
      discount_amount_cents: Math.round(8500 * 0.5),
      cogs_unit_cents: 4200,
      customer_id: `cust-l-${i % 45}`,
      order_ts: new Date(now - (13 - (i % 7)) * day),
      campaign_tag: 'blowout-50',
      channel: 'email',
      is_first_order: i % 10 === 0,
    })
  }
  await db.insert(order_lines).values(lines)
  await db
    .update(ingestion_runs)
    .set({ row_count: lines.length })
    .where(eq(ingestion_runs.id, run.id))

  console.log('Seeded demo brand')
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate + seed (both idempotent) so a slow
// cold DB connection never blocks the port binding.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

try {
  await migrate()
} catch (e) {
  console.error('Migrate error:', e)
}
try {
  await seedIfEmpty()
} catch (e) {
  console.error('Seed error:', e)
}

export default app
