import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent, self-provisioning DDL. Column names/types match schema.ts exactly.
// timestamps -> timestamptz, money -> integer (cents), ratios/pcts -> real,
// json -> jsonb, ids/text -> text.
const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    name text NOT NULL DEFAULT 'My Workspace',
    currency text NOT NULL DEFAULT 'USD',
    platform_fee_pct real NOT NULL DEFAULT 0,
    pre_period_days integer NOT NULL DEFAULT 28,
    pull_forward_days integer NOT NULL DEFAULT 14,
    flag_min_contribution_cents integer NOT NULL DEFAULT 0,
    flag_min_margin_pct real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS skus (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    sku_code text NOT NULL,
    name text NOT NULL,
    collection text,
    list_price_cents integer NOT NULL DEFAULT 0,
    cogs_unit_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, sku_code)
  )`,

  `CREATE TABLE IF NOT EXISTS cogs_overrides (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    sku_id text NOT NULL REFERENCES skus(id),
    cogs_unit_cents integer NOT NULL,
    effective_from timestamptz NOT NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS promos (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    promo_type text NOT NULL DEFAULT 'sitewide_pct',
    discount_depth_pct real NOT NULL DEFAULT 0,
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'planned',
    campaign_tag text,
    channel_scope jsonb DEFAULT '[]'::jsonb,
    eligible_skus jsonb DEFAULT '[]'::jsonb,
    owner text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ingestion_runs (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    filename text NOT NULL,
    source text NOT NULL DEFAULT 'csv',
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'completed',
    summary jsonb DEFAULT '{}'::jsonb,
    errors jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS order_lines (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    ingestion_run_id text REFERENCES ingestion_runs(id),
    promo_id text REFERENCES promos(id),
    order_id text NOT NULL,
    sku_code text NOT NULL,
    qty integer NOT NULL DEFAULT 1,
    unit_price_cents integer NOT NULL DEFAULT 0,
    discount_amount_cents integer NOT NULL DEFAULT 0,
    cogs_unit_cents integer NOT NULL DEFAULT 0,
    customer_id text NOT NULL,
    order_ts timestamptz NOT NULL,
    campaign_tag text,
    channel text,
    is_first_order boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS column_mappings (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    mapping jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS promo_pnl (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL UNIQUE REFERENCES promos(id),
    gross_revenue_cents integer NOT NULL DEFAULT 0,
    discount_cents integer NOT NULL DEFAULT 0,
    net_revenue_cents integer NOT NULL DEFAULT 0,
    cogs_cents integer NOT NULL DEFAULT 0,
    platform_fee_cents integer NOT NULL DEFAULT 0,
    contribution_cents integer NOT NULL DEFAULT 0,
    realized_margin_pct real NOT NULL DEFAULT 0,
    list_margin_pct real NOT NULL DEFAULT 0,
    units integer NOT NULL DEFAULT 0,
    avg_order_value_cents integer NOT NULL DEFAULT 0,
    waterfall jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS incrementality_results (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL REFERENCES promos(id),
    method text NOT NULL DEFAULT 'pre_period',
    baseline_units real NOT NULL DEFAULT 0,
    observed_units real NOT NULL DEFAULT 0,
    incremental_units real NOT NULL DEFAULT 0,
    incremental_revenue_cents integer NOT NULL DEFAULT 0,
    incrementality_ratio real NOT NULL DEFAULT 0,
    confidence_low real NOT NULL DEFAULT 0,
    confidence_high real NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promo_id, method)
  )`,

  `CREATE TABLE IF NOT EXISTS cannibalization_results (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL UNIQUE REFERENCES promos(id),
    pull_forward_units real NOT NULL DEFAULT 0,
    pull_forward_revenue_cents integer NOT NULL DEFAULT 0,
    cross_sku_revenue_cents integer NOT NULL DEFAULT 0,
    already_converting_pct real NOT NULL DEFAULT 0,
    dollar_adjustment_cents integer NOT NULL DEFAULT 0,
    detail jsonb DEFAULT '{}'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS customer_splits (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL UNIQUE REFERENCES promos(id),
    new_count integer NOT NULL DEFAULT 0,
    existing_count integer NOT NULL DEFAULT 0,
    new_contribution_cents integer NOT NULL DEFAULT 0,
    existing_contribution_cents integer NOT NULL DEFAULT 0,
    existing_subsidy_cents integer NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS elasticity_curves (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    scope text NOT NULL DEFAULT 'global',
    scope_id text,
    coefficient real NOT NULL DEFAULT 0,
    optimal_depth_pct real NOT NULL DEFAULT 0,
    optimal_contribution_cents integer NOT NULL DEFAULT 0,
    curve_points jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, scope, scope_id)
  )`,

  `CREATE TABLE IF NOT EXISTS scenarios (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    base_promo_id text REFERENCES promos(id),
    params jsonb DEFAULT '{}'::jsonb,
    projected_contribution_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS promo_alerts (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL REFERENCES promos(id),
    severity text NOT NULL DEFAULT 'medium',
    dollars_destroyed_cents integer NOT NULL DEFAULT 0,
    recommendation text NOT NULL DEFAULT 'review',
    is_recurring boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'open',
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cohorts (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text REFERENCES promos(id),
    name text NOT NULL,
    customer_count integer NOT NULL DEFAULT 0,
    repeat_rate real NOT NULL DEFAULT 0,
    customer_ids jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS segments (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL DEFAULT 'control',
    criteria jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS channel_stats (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text NOT NULL REFERENCES promos(id),
    channel text NOT NULL,
    revenue_cents integer NOT NULL DEFAULT 0,
    incremental_contribution_cents integer NOT NULL DEFAULT 0,
    mix_pct real NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (promo_id, channel)
  )`,

  `CREATE TABLE IF NOT EXISTS benchmarks (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    scope text NOT NULL DEFAULT 'promo',
    scope_id text,
    label text NOT NULL,
    target_margin_pct real NOT NULL DEFAULT 0,
    target_contribution_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'retrospective',
    scope text NOT NULL DEFAULT 'promo',
    scope_id text,
    title text NOT NULL,
    period_start timestamptz,
    period_end timestamptz,
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS calendar_entries (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    promo_id text REFERENCES promos(id),
    name text NOT NULL,
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'planned',
    projected_contribution_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_skus_user ON skus(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cogs_overrides_sku ON cogs_overrides(sku_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cogs_overrides_user ON cogs_overrides(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_promos_user ON promos(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ingestion_runs_user ON ingestion_runs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_lines_user ON order_lines(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_lines_promo ON order_lines(promo_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_lines_run ON order_lines(ingestion_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_lines_sku ON order_lines(sku_code)`,
  `CREATE INDEX IF NOT EXISTS idx_column_mappings_user ON column_mappings(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_promo_pnl_user ON promo_pnl(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_incrementality_promo ON incrementality_results(promo_id)`,
  `CREATE INDEX IF NOT EXISTS idx_incrementality_user ON incrementality_results(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cannibalization_user ON cannibalization_results(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_splits_user ON customer_splits(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elasticity_user ON elasticity_curves(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_user ON scenarios(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_promo_alerts_user ON promo_alerts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_promo_alerts_promo ON promo_alerts(promo_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cohorts_user ON cohorts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_segments_user ON segments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_channel_stats_promo ON channel_stats(promo_id)`,
  `CREATE INDEX IF NOT EXISTS idx_channel_stats_user ON channel_stats(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmarks_user ON benchmarks(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_entries_user ON calendar_entries(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const stmt of indexes) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete: tables and indexes provisioned')
}
