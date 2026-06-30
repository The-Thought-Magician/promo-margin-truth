import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  unique,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Workspace / configuration
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  name: text('name').notNull().default('My Workspace'),
  currency: text('currency').notNull().default('USD'),
  platform_fee_pct: real('platform_fee_pct').notNull().default(0),
  pre_period_days: integer('pre_period_days').notNull().default(28),
  pull_forward_days: integer('pull_forward_days').notNull().default(14),
  flag_min_contribution_cents: integer('flag_min_contribution_cents').notNull().default(0),
  flag_min_margin_pct: real('flag_min_margin_pct').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// SKU catalog + COGS
// ---------------------------------------------------------------------------

export const skus = pgTable('skus', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  sku_code: text('sku_code').notNull(),
  name: text('name').notNull(),
  collection: text('collection'),
  list_price_cents: integer('list_price_cents').notNull().default(0),
  cogs_unit_cents: integer('cogs_unit_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.sku_code)])

export const cogs_overrides = pgTable('cogs_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  sku_id: text('sku_id').notNull().references(() => skus.id),
  cogs_unit_cents: integer('cogs_unit_cents').notNull(),
  effective_from: timestamp('effective_from').notNull(),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Promo definitions
// ---------------------------------------------------------------------------

export const promos = pgTable('promos', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  promo_type: text('promo_type').notNull().default('sitewide_pct'),
  discount_depth_pct: real('discount_depth_pct').notNull().default(0),
  start_at: timestamp('start_at').notNull(),
  end_at: timestamp('end_at').notNull(),
  status: text('status').notNull().default('planned'),
  campaign_tag: text('campaign_tag'),
  channel_scope: jsonb('channel_scope').$type<string[]>().default([]),
  eligible_skus: jsonb('eligible_skus').$type<string[]>().default([]),
  owner: text('owner'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export const ingestion_runs = pgTable('ingestion_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  filename: text('filename').notNull(),
  source: text('source').notNull().default('csv'),
  row_count: integer('row_count').notNull().default(0),
  error_count: integer('error_count').notNull().default(0),
  status: text('status').notNull().default('completed'),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const order_lines = pgTable('order_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  ingestion_run_id: text('ingestion_run_id').references(() => ingestion_runs.id),
  promo_id: text('promo_id').references(() => promos.id),
  order_id: text('order_id').notNull(),
  sku_code: text('sku_code').notNull(),
  qty: integer('qty').notNull().default(1),
  unit_price_cents: integer('unit_price_cents').notNull().default(0),
  discount_amount_cents: integer('discount_amount_cents').notNull().default(0),
  cogs_unit_cents: integer('cogs_unit_cents').notNull().default(0),
  customer_id: text('customer_id').notNull(),
  order_ts: timestamp('order_ts').notNull(),
  campaign_tag: text('campaign_tag'),
  channel: text('channel'),
  is_first_order: boolean('is_first_order').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const column_mappings = pgTable('column_mappings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Analysis results
// ---------------------------------------------------------------------------

export const promo_pnl = pgTable('promo_pnl', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id).unique(),
  gross_revenue_cents: integer('gross_revenue_cents').notNull().default(0),
  discount_cents: integer('discount_cents').notNull().default(0),
  net_revenue_cents: integer('net_revenue_cents').notNull().default(0),
  cogs_cents: integer('cogs_cents').notNull().default(0),
  platform_fee_cents: integer('platform_fee_cents').notNull().default(0),
  contribution_cents: integer('contribution_cents').notNull().default(0),
  realized_margin_pct: real('realized_margin_pct').notNull().default(0),
  list_margin_pct: real('list_margin_pct').notNull().default(0),
  units: integer('units').notNull().default(0),
  avg_order_value_cents: integer('avg_order_value_cents').notNull().default(0),
  waterfall: jsonb('waterfall').$type<Array<{ label: string; cents: number }>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

export const incrementality_results = pgTable('incrementality_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id),
  method: text('method').notNull().default('pre_period'),
  baseline_units: real('baseline_units').notNull().default(0),
  observed_units: real('observed_units').notNull().default(0),
  incremental_units: real('incremental_units').notNull().default(0),
  incremental_revenue_cents: integer('incremental_revenue_cents').notNull().default(0),
  incrementality_ratio: real('incrementality_ratio').notNull().default(0),
  confidence_low: real('confidence_low').notNull().default(0),
  confidence_high: real('confidence_high').notNull().default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
}, (t) => [unique().on(t.promo_id, t.method)])

export const cannibalization_results = pgTable('cannibalization_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id).unique(),
  pull_forward_units: real('pull_forward_units').notNull().default(0),
  pull_forward_revenue_cents: integer('pull_forward_revenue_cents').notNull().default(0),
  cross_sku_revenue_cents: integer('cross_sku_revenue_cents').notNull().default(0),
  already_converting_pct: real('already_converting_pct').notNull().default(0),
  dollar_adjustment_cents: integer('dollar_adjustment_cents').notNull().default(0),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

export const customer_splits = pgTable('customer_splits', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id).unique(),
  new_count: integer('new_count').notNull().default(0),
  existing_count: integer('existing_count').notNull().default(0),
  new_contribution_cents: integer('new_contribution_cents').notNull().default(0),
  existing_contribution_cents: integer('existing_contribution_cents').notNull().default(0),
  existing_subsidy_cents: integer('existing_subsidy_cents').notNull().default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

export const elasticity_curves = pgTable('elasticity_curves', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  scope: text('scope').notNull().default('global'),
  scope_id: text('scope_id'),
  coefficient: real('coefficient').notNull().default(0),
  optimal_depth_pct: real('optimal_depth_pct').notNull().default(0),
  optimal_contribution_cents: integer('optimal_contribution_cents').notNull().default(0),
  curve_points: jsonb('curve_points').$type<Array<{ depth: number; contribution_cents: number }>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.scope, t.scope_id)])

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  base_promo_id: text('base_promo_id').references(() => promos.id),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  projected_contribution_cents: integer('projected_contribution_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const promo_alerts = pgTable('promo_alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id),
  severity: text('severity').notNull().default('medium'),
  dollars_destroyed_cents: integer('dollars_destroyed_cents').notNull().default(0),
  recommendation: text('recommendation').notNull().default('review'),
  is_recurring: boolean('is_recurring').notNull().default(false),
  status: text('status').notNull().default('open'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const cohorts = pgTable('cohorts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').references(() => promos.id),
  name: text('name').notNull(),
  customer_count: integer('customer_count').notNull().default(0),
  repeat_rate: real('repeat_rate').notNull().default(0),
  customer_ids: jsonb('customer_ids').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const segments = pgTable('segments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('control'),
  criteria: jsonb('criteria').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const channel_stats = pgTable('channel_stats', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').notNull().references(() => promos.id),
  channel: text('channel').notNull(),
  revenue_cents: integer('revenue_cents').notNull().default(0),
  incremental_contribution_cents: integer('incremental_contribution_cents').notNull().default(0),
  mix_pct: real('mix_pct').notNull().default(0),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
}, (t) => [unique().on(t.promo_id, t.channel)])

export const benchmarks = pgTable('benchmarks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  scope: text('scope').notNull().default('promo'),
  scope_id: text('scope_id'),
  label: text('label').notNull(),
  target_margin_pct: real('target_margin_pct').notNull().default(0),
  target_contribution_cents: integer('target_contribution_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull().default('retrospective'),
  scope: text('scope').notNull().default('promo'),
  scope_id: text('scope_id'),
  title: text('title').notNull(),
  period_start: timestamp('period_start'),
  period_end: timestamp('period_end'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull().default('info'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  read: boolean('read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const calendar_entries = pgTable('calendar_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  promo_id: text('promo_id').references(() => promos.id),
  name: text('name').notNull(),
  start_at: timestamp('start_at').notNull(),
  end_at: timestamp('end_at').notNull(),
  status: text('status').notNull().default('planned'),
  projected_contribution_cents: integer('projected_contribution_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
