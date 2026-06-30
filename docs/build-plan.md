# PromoMarginTruth — Authoritative Build Contract

> Single source of truth. Every other agent (backend, frontend, tests) MUST follow filenames, mount paths, api method names, and page files declared here EXACTLY. They are binding.
>
> Stack: Hono 4.12.27 backend (`/api/v1` child router, `X-User-Id` trust, `getUserId(c)`), Next.js 16 frontend (`proxy.ts` only, relative `fetch('/api/proxy/...')`), Neon Postgres + drizzle-orm, `@neondatabase/auth@0.4.2-beta`. Money stored as integer cents. Public reads / auth-gated writes with zod + ownership checks. All routers `export default router`.

---

## (a) Database Tables

Schema is in `backend/src/db/schema.ts`; idempotent DDL in `backend/src/db/migrate.ts`. App ids: `text('id').primaryKey().$defaultFn(() => crypto.randomUUID())`. Timestamps `timestamptz`. Money in `*_cents` integers. Ratios/percentages `real`.

| Table | Key columns |
|-------|-------------|
| `workspaces` | id, user_id (unique), name, currency, platform_fee_pct, pre_period_days, pull_forward_days, flag_min_contribution_cents, flag_min_margin_pct, created_at, updated_at |
| `skus` | id, user_id, sku_code, name, collection, list_price_cents, cogs_unit_cents, created_at, updated_at; UNIQUE(user_id, sku_code) |
| `cogs_overrides` | id, user_id, sku_id→skus, cogs_unit_cents, effective_from, note, created_at |
| `promos` | id, user_id, name, promo_type, discount_depth_pct, start_at, end_at, status, campaign_tag, channel_scope jsonb, eligible_skus jsonb, owner, notes, created_at, updated_at |
| `ingestion_runs` | id, user_id, filename, source, row_count, error_count, status, summary jsonb, errors jsonb, created_at |
| `order_lines` | id, user_id, ingestion_run_id→ingestion_runs, promo_id→promos, order_id, sku_code, qty, unit_price_cents, discount_amount_cents, cogs_unit_cents, customer_id, order_ts, campaign_tag, channel, is_first_order, created_at |
| `column_mappings` | id, user_id, name, mapping jsonb, created_at |
| `promo_pnl` | id, user_id, promo_id→promos (unique), gross_revenue_cents, discount_cents, net_revenue_cents, cogs_cents, platform_fee_cents, contribution_cents, realized_margin_pct, list_margin_pct, units, avg_order_value_cents, waterfall jsonb, computed_at |
| `incrementality_results` | id, user_id, promo_id→promos, method, baseline_units, observed_units, incremental_units, incremental_revenue_cents, incrementality_ratio, confidence_low, confidence_high, computed_at; UNIQUE(promo_id, method) |
| `cannibalization_results` | id, user_id, promo_id→promos (unique), pull_forward_units, pull_forward_revenue_cents, cross_sku_revenue_cents, already_converting_pct, dollar_adjustment_cents, detail jsonb, computed_at |
| `customer_splits` | id, user_id, promo_id→promos (unique), new_count, existing_count, new_contribution_cents, existing_contribution_cents, existing_subsidy_cents, computed_at |
| `elasticity_curves` | id, user_id, scope, scope_id, coefficient, optimal_depth_pct, optimal_contribution_cents, curve_points jsonb, computed_at; UNIQUE(user_id, scope, scope_id) |
| `scenarios` | id, user_id, name, base_promo_id→promos, params jsonb, projected_contribution_cents, created_at, updated_at |
| `promo_alerts` | id, user_id, promo_id→promos, severity, dollars_destroyed_cents, recommendation, is_recurring, status, detail jsonb, created_at |
| `cohorts` | id, user_id, promo_id→promos, name, customer_count, repeat_rate, customer_ids jsonb, created_at |
| `segments` | id, user_id, name, kind, criteria jsonb, created_at |
| `channel_stats` | id, user_id, promo_id→promos, channel, revenue_cents, incremental_contribution_cents, mix_pct, computed_at; UNIQUE(promo_id, channel) |
| `benchmarks` | id, user_id, scope, scope_id, label, target_margin_pct, target_contribution_cents, created_at |
| `reports` | id, user_id, kind, scope, scope_id, title, period_start, period_end, payload jsonb, created_at |
| `notifications` | id, user_id, kind, title, body, read, created_at |
| `activity_log` | id, user_id, action, entity, entity_id, detail jsonb, created_at |
| `calendar_entries` | id, user_id, promo_id→promos, name, start_at, end_at, status, projected_contribution_cents, created_at |
| `plans` | id (text 'free'/'pro'), name, price_cents |
| `subscriptions` | id, user_id (unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at |

---

## (b) Backend Route Files

All mounted in `index.ts` via `const api = new Hono(); api.route('/<mount>', router); app.route('/api/v1', api)`. Each file does `export default router`. Public = no auth (reads), Auth = `authMiddleware` + `getUserId(c)` + ownership check. Mutations use zod validation. 25 route files.

### 1. `workspace.ts` → mount `workspace`
- `GET /` — Auth — get current user's workspace (auto-create defaults if absent) — `{ workspace }`
- `PUT /` — Auth — update config (name, currency, platform_fee_pct, pre_period_days, pull_forward_days, flag_min_contribution_cents, flag_min_margin_pct) — `{ workspace }`

### 2. `skus.ts` → mount `skus`
- `GET /` — Public — list SKUs for user (query `?user_id` optional; falls back) — `Sku[]`
- `GET /missing-cogs` — Auth — SKUs with cogs_unit_cents = 0 — `Sku[]`
- `GET /:id` — Public — one SKU — `Sku | 404`
- `POST /` — Auth — create SKU — `Sku` 201
- `PUT /:id` — Auth — update SKU — `Sku`
- `DELETE /:id` — Auth — delete SKU — `{ success }`
- `POST /bulk` — Auth — bulk import array of SKUs — `{ inserted }` 201

### 3. `cogs.ts` → mount `cogs`
- `GET /` — Public — list cogs_overrides (query `?sku_id`) — `CogsOverride[]`
- `POST /` — Auth — create override — `CogsOverride` 201
- `DELETE /:id` — Auth — delete override — `{ success }`

### 4. `promos.ts` → mount `promos`
- `GET /` — Public — list promos — `Promo[]`
- `GET /:id` — Public — one promo — `Promo | 404`
- `POST /` — Auth — create promo — `Promo` 201
- `PUT /:id` — Auth — update promo — `Promo`
- `DELETE /:id` — Auth — delete promo — `{ success }`
- `POST /:id/clone` — Auth — clone promo (new name/window) — `Promo` 201
- `POST /:id/status` — Auth — set status (planned|active|ended|analyzed) — `Promo`

### 5. `ingest.ts` → mount `ingest`
- `GET /runs` — Public — list ingestion runs — `IngestionRun[]`
- `GET /runs/:id` — Public — run detail — `IngestionRun | 404`
- `POST /upload` — Auth — accept `{ filename, rows: OrderLineInput[], mappingName? }`, validate, insert order_lines, attach promo by campaign_tag/window, create run — `{ run }` 201
- `DELETE /runs/:id` — Auth — delete run + its order_lines — `{ success }`
- `POST /sample` — Auth — seed demo brand (SKUs, promos incl. one money-losing, order_lines, run) — `{ run, promos, skus }` 201

### 6. `orders.ts` → mount `orders`
- `GET /` — Public — list order_lines (filters `?promo_id&sku_code&run_id&limit`) — `OrderLine[]`
- `GET /summary` — Public — aggregate totals (count, gross, discount, units) — `{ summary }`

### 7. `mappings.ts` → mount `mappings`
- `GET /` — Public — list column mappings — `ColumnMapping[]`
- `POST /` — Auth — save mapping — `ColumnMapping` 201
- `PUT /:id` — Auth — update mapping — `ColumnMapping`
- `DELETE /:id` — Auth — delete mapping — `{ success }`

### 8. `pnl.ts` → mount `pnl`
- `GET /` — Public — list all promo_pnl — `PromoPnl[]`
- `GET /:promoId` — Public — P&L for a promo — `PromoPnl | 404`
- `POST /:promoId/compute` — Auth — compute & upsert P&L from order_lines + COGS + platform_fee — `PromoPnl` 201

### 9. `incrementality.ts` → mount `incrementality`
- `GET /:promoId` — Public — incrementality results for promo — `IncrementalityResult[]`
- `POST /:promoId/compute` — Auth — compute baseline (pre_period|control|blended via body.method) & upsert — `IncrementalityResult` 201

### 10. `cannibalization.ts` → mount `cannibalization`
- `GET /:promoId` — Public — cannibalization result — `CannibalizationResult | null`
- `POST /:promoId/compute` — Auth — compute pull-forward + cross-SKU + already-converting & upsert — `CannibalizationResult` 201

### 11. `splits.ts` → mount `splits`
- `GET /:promoId` — Public — new-vs-existing split — `CustomerSplit | null`
- `POST /:promoId/compute` — Auth — compute split from is_first_order & upsert — `CustomerSplit` 201

### 12. `elasticity.ts` → mount `elasticity`
- `GET /` — Public — list fitted curves — `ElasticityCurve[]`
- `GET /:scope/:scopeId` — Public — one curve (scopeId may be `global`) — `ElasticityCurve | null`
- `POST /fit` — Auth — fit curve for scope (`{ scope, scope_id }`) across promos & upsert — `ElasticityCurve` 201
- `POST /point` — Auth — project net contribution at a given depth (`{ scope, scope_id, depth_pct }`) — `{ depth_pct, contribution_cents }`

### 13. `scenarios.ts` → mount `scenarios`
- `GET /` — Public — list scenarios — `Scenario[]`
- `GET /:id` — Public — one scenario — `Scenario | 404`
- `POST /` — Auth — create scenario (auto-projects via elasticity) — `Scenario` 201
- `PUT /:id` — Auth — update scenario (re-projects) — `Scenario`
- `DELETE /:id` — Auth — delete — `{ success }`

### 14. `alerts.ts` → mount `alerts`
- `GET /` — Public — list promo_alerts (filter `?status`) — `PromoAlert[]`
- `POST /scan` — Auth — recompute alerts from latest P&L+adjustments, flag negatives, detect recurring — `{ created, alerts }` 201
- `POST /:id/ack` — Auth — set status acknowledged — `PromoAlert`
- `POST /:id/snooze` — Auth — set status snoozed — `PromoAlert`
- `POST /:id/resolve` — Auth — set status resolved — `PromoAlert`

### 15. `retrospective.ts` → mount `retrospective`
- `POST /promo/:promoId` — Auth — generate per-promo retrospective report (saves to reports) — `Report` 201
- `POST /period` — Auth — generate period teardown (`{ start, end, title }`) across promos — `Report` 201
- `GET /recovery` — Public — dollar-recovery summary (recoverable contribution from open alerts) — `{ recoverable_cents, by_promo }`

### 16. `calendar.ts` → mount `calendar`
- `GET /` — Public — list calendar_entries — `CalendarEntry[]`
- `GET /overlaps` — Public — detect overlapping windows — `{ overlaps: Array<{ a, b, days }> }`
- `POST /` — Auth — create calendar entry — `CalendarEntry` 201
- `PUT /:id` — Auth — update entry — `CalendarEntry`
- `DELETE /:id` — Auth — delete entry — `{ success }`

### 17. `cohorts.ts` → mount `cohorts`
- `GET /` — Public — list cohorts — `Cohort[]`
- `POST /build` — Auth — build acquisition cohort for a promo (`{ promo_id }`) — `Cohort` 201
- `DELETE /:id` — Auth — delete cohort — `{ success }`

### 18. `segments.ts` → mount `segments`
- `GET /` — Public — list segments — `Segment[]`
- `POST /` — Auth — create control/segment — `Segment` 201
- `PUT /:id` — Auth — update segment — `Segment`
- `DELETE /:id` — Auth — delete segment — `{ success }`

### 19. `channels.ts` → mount `channels`
- `GET /:promoId` — Public — per-channel stats for promo — `ChannelStat[]`
- `POST /:promoId/compute` — Auth — compute channel breakdown & upsert — `{ stats }` 201

### 20. `benchmarks.ts` → mount `benchmarks`
- `GET /` — Public — list benchmarks — `Benchmark[]`
- `GET /variance` — Public — benchmark vs realized variance — `{ rows: Array<{ scope_id, target, actual, variance }> }`
- `POST /` — Auth — create benchmark/target — `Benchmark` 201
- `PUT /:id` — Auth — update — `Benchmark`
- `DELETE /:id` — Auth — delete — `{ success }`

### 21. `dashboard.ts` → mount `dashboard`
- `GET /overview` — Public — portfolio KPIs (promo count, total contribution, dollars destroyed, recoverable) — `{ kpis }`
- `GET /leaderboard` — Public — top winners / top losers by contribution — `{ winners, losers }`
- `GET /margin-trend` — Public — realized-margin trend across promos by end_at — `{ points }`

### 22. `reports.ts` → mount `reports`
- `GET /` — Public — list reports — `Report[]`
- `GET /:id` — Public — report detail — `Report | 404`
- `POST /:id/rerun` — Auth — regenerate report payload against latest data — `Report`
- `DELETE /:id` — Auth — delete report — `{ success }`

### 23. `notifications.ts` → mount `notifications`
- `GET /` — Public — list user notifications — `Notification[]`
- `POST /:id/read` — Auth — mark read — `Notification`
- `POST /read-all` — Auth — mark all read — `{ success }`

### 24. `activity.ts` → mount `activity`
- `GET /` — Public — list activity_log (filter `?entity&entity_id&limit`) — `ActivityLog[]`

### 25. `billing.ts` → mount `billing`
- `GET /plan` — Public-ish (reads X-User-Id) — current subscription + plan + stripeEnabled — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — Auth — Stripe checkout session or 503 — `{ url } | 503`
- `POST /portal` — Auth — Stripe billing portal or 503 — `{ url } | 503`
- `POST /webhook` — none — Stripe webhook handler or 503 — `{ received } | 503`

> Note: `health` is served by `app.get('/health')` in `index.ts` directly (not a mounted route file). Seed `plans` (free/pro) in `seedIfEmpty()`.

---

## (c) `web/lib/api.ts` Method List

Every method is `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. Mutations send `Content-Type: application/json` + `JSON.stringify`. `export default api`. Each method is implemented by exactly one backend endpoint above.

| Method | Verb | Proxy path |
|--------|------|-----------|
| `getWorkspace` | GET | `/api/proxy/workspace` |
| `updateWorkspace` | PUT | `/api/proxy/workspace` |
| `getSkus` | GET | `/api/proxy/skus` |
| `getMissingCogs` | GET | `/api/proxy/skus/missing-cogs` |
| `getSku` | GET | `/api/proxy/skus/:id` |
| `createSku` | POST | `/api/proxy/skus` |
| `updateSku` | PUT | `/api/proxy/skus/:id` |
| `deleteSku` | DELETE | `/api/proxy/skus/:id` |
| `bulkImportSkus` | POST | `/api/proxy/skus/bulk` |
| `getCogsOverrides` | GET | `/api/proxy/cogs` |
| `createCogsOverride` | POST | `/api/proxy/cogs` |
| `deleteCogsOverride` | DELETE | `/api/proxy/cogs/:id` |
| `getPromos` | GET | `/api/proxy/promos` |
| `getPromo` | GET | `/api/proxy/promos/:id` |
| `createPromo` | POST | `/api/proxy/promos` |
| `updatePromo` | PUT | `/api/proxy/promos/:id` |
| `deletePromo` | DELETE | `/api/proxy/promos/:id` |
| `clonePromo` | POST | `/api/proxy/promos/:id/clone` |
| `setPromoStatus` | POST | `/api/proxy/promos/:id/status` |
| `getIngestionRuns` | GET | `/api/proxy/ingest/runs` |
| `getIngestionRun` | GET | `/api/proxy/ingest/runs/:id` |
| `uploadData` | POST | `/api/proxy/ingest/upload` |
| `deleteIngestionRun` | DELETE | `/api/proxy/ingest/runs/:id` |
| `seedSampleData` | POST | `/api/proxy/ingest/sample` |
| `getOrders` | GET | `/api/proxy/orders` |
| `getOrdersSummary` | GET | `/api/proxy/orders/summary` |
| `getMappings` | GET | `/api/proxy/mappings` |
| `createMapping` | POST | `/api/proxy/mappings` |
| `updateMapping` | PUT | `/api/proxy/mappings/:id` |
| `deleteMapping` | DELETE | `/api/proxy/mappings/:id` |
| `getPnlList` | GET | `/api/proxy/pnl` |
| `getPnl` | GET | `/api/proxy/pnl/:promoId` |
| `computePnl` | POST | `/api/proxy/pnl/:promoId/compute` |
| `getIncrementality` | GET | `/api/proxy/incrementality/:promoId` |
| `computeIncrementality` | POST | `/api/proxy/incrementality/:promoId/compute` |
| `getCannibalization` | GET | `/api/proxy/cannibalization/:promoId` |
| `computeCannibalization` | POST | `/api/proxy/cannibalization/:promoId/compute` |
| `getSplit` | GET | `/api/proxy/splits/:promoId` |
| `computeSplit` | POST | `/api/proxy/splits/:promoId/compute` |
| `getElasticityCurves` | GET | `/api/proxy/elasticity` |
| `getElasticityCurve` | GET | `/api/proxy/elasticity/:scope/:scopeId` |
| `fitElasticity` | POST | `/api/proxy/elasticity/fit` |
| `projectElasticityPoint` | POST | `/api/proxy/elasticity/point` |
| `getScenarios` | GET | `/api/proxy/scenarios` |
| `getScenario` | GET | `/api/proxy/scenarios/:id` |
| `createScenario` | POST | `/api/proxy/scenarios` |
| `updateScenario` | PUT | `/api/proxy/scenarios/:id` |
| `deleteScenario` | DELETE | `/api/proxy/scenarios/:id` |
| `getAlerts` | GET | `/api/proxy/alerts` |
| `scanAlerts` | POST | `/api/proxy/alerts/scan` |
| `ackAlert` | POST | `/api/proxy/alerts/:id/ack` |
| `snoozeAlert` | POST | `/api/proxy/alerts/:id/snooze` |
| `resolveAlert` | POST | `/api/proxy/alerts/:id/resolve` |
| `generatePromoRetro` | POST | `/api/proxy/retrospective/promo/:promoId` |
| `generatePeriodRetro` | POST | `/api/proxy/retrospective/period` |
| `getRecoverySummary` | GET | `/api/proxy/retrospective/recovery` |
| `getCalendar` | GET | `/api/proxy/calendar` |
| `getCalendarOverlaps` | GET | `/api/proxy/calendar/overlaps` |
| `createCalendarEntry` | POST | `/api/proxy/calendar` |
| `updateCalendarEntry` | PUT | `/api/proxy/calendar/:id` |
| `deleteCalendarEntry` | DELETE | `/api/proxy/calendar/:id` |
| `getCohorts` | GET | `/api/proxy/cohorts` |
| `buildCohort` | POST | `/api/proxy/cohorts/build` |
| `deleteCohort` | DELETE | `/api/proxy/cohorts/:id` |
| `getSegments` | GET | `/api/proxy/segments` |
| `createSegment` | POST | `/api/proxy/segments` |
| `updateSegment` | PUT | `/api/proxy/segments/:id` |
| `deleteSegment` | DELETE | `/api/proxy/segments/:id` |
| `getChannelStats` | GET | `/api/proxy/channels/:promoId` |
| `computeChannelStats` | POST | `/api/proxy/channels/:promoId/compute` |
| `getBenchmarks` | GET | `/api/proxy/benchmarks` |
| `getBenchmarkVariance` | GET | `/api/proxy/benchmarks/variance` |
| `createBenchmark` | POST | `/api/proxy/benchmarks` |
| `updateBenchmark` | PUT | `/api/proxy/benchmarks/:id` |
| `deleteBenchmark` | DELETE | `/api/proxy/benchmarks/:id` |
| `getDashboardOverview` | GET | `/api/proxy/dashboard/overview` |
| `getDashboardLeaderboard` | GET | `/api/proxy/dashboard/leaderboard` |
| `getMarginTrend` | GET | `/api/proxy/dashboard/margin-trend` |
| `getReports` | GET | `/api/proxy/reports` |
| `getReport` | GET | `/api/proxy/reports/:id` |
| `rerunReport` | POST | `/api/proxy/reports/:id/rerun` |
| `deleteReport` | DELETE | `/api/proxy/reports/:id` |
| `getNotifications` | GET | `/api/proxy/notifications` |
| `markNotificationRead` | POST | `/api/proxy/notifications/:id/read` |
| `markAllNotificationsRead` | POST | `/api/proxy/notifications/read-all` |
| `getActivity` | GET | `/api/proxy/activity` |
| `getBillingPlan` | GET | `/api/proxy/billing/plan` |
| `startCheckout` | POST | `/api/proxy/billing/checkout` |
| `openBillingPortal` | POST | `/api/proxy/billing/portal` |

---

## (d) Page List

Files under `web/app/`. Public pages: no auth calls (landing fully static). Dashboard pages: client components under `/dashboard/*`, wrapped by `web/app/dashboard/layout.tsx` → `DashboardLayout`, guarded by `proxy.ts` matcher + per-page `authClient.getSession()`. 25 pages.

| URL path | File | Kind | API methods used | Renders |
|----------|------|------|------------------|---------|
| `/` | `app/page.tsx` | public | (none) | Static landing: hero, the margin-truth pitch, feature grid, CTAs |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | Sign-in form (client onSubmit + authClient) |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | Sign-up form (client onSubmit + authClient) |
| `/pricing` | `app/pricing/page.tsx` | public | `getBillingPlan`, `startCheckout` | Free vs Pro plans, upgrade CTA |
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | `getDashboardOverview`, `getDashboardLeaderboard`, `getMarginTrend`, `getRecoverySummary` | KPI cards, winners/losers, margin trend, recoverable dollars |
| `/dashboard/data` | `app/dashboard/data/page.tsx` | dashboard | `getIngestionRuns`, `uploadData`, `seedSampleData`, `deleteIngestionRun` | Upload CSV, seed sample, runs list w/ error counts |
| `/dashboard/data/map` | `app/dashboard/data/map/page.tsx` | dashboard | `getMappings`, `createMapping`, `updateMapping`, `deleteMapping` | CSV header → canonical column mapping editor |
| `/dashboard/orders` | `app/dashboard/orders/page.tsx` | dashboard | `getOrders`, `getOrdersSummary`, `getPromos` | Order-line explorer with filters + summary |
| `/dashboard/skus` | `app/dashboard/skus/page.tsx` | dashboard | `getSkus`, `createSku`, `updateSku`, `deleteSku`, `bulkImportSkus`, `getMissingCogs`, `getCogsOverrides`, `createCogsOverride`, `deleteCogsOverride` | SKU & COGS management, missing-COGS warnings, overrides |
| `/dashboard/promos` | `app/dashboard/promos/page.tsx` | dashboard | `getPromos`, `createPromo`, `deletePromo`, `clonePromo`, `setPromoStatus` | Promo catalog list with status + actions |
| `/dashboard/promos/[id]` | `app/dashboard/promos/[id]/page.tsx` | dashboard | `getPromo`, `updatePromo`, `getPnl`, `computePnl`, `getIncrementality`, `computeIncrementality`, `getCannibalization`, `computeCannibalization`, `getSplit`, `computeSplit` | Promo detail: P&L waterfall, incrementality, cannibalization, customer split |
| `/dashboard/calendar` | `app/dashboard/calendar/page.tsx` | dashboard | `getCalendar`, `getCalendarOverlaps`, `createCalendarEntry`, `updateCalendarEntry`, `deleteCalendarEntry`, `getPromos` | Promo calendar with overlap warnings + projected contribution |
| `/dashboard/incrementality` | `app/dashboard/incrementality/page.tsx` | dashboard | `getPromos`, `getIncrementality`, `computeIncrementality` | Incrementality workbench: method toggle, baseline vs observed, confidence band |
| `/dashboard/cannibalization` | `app/dashboard/cannibalization/page.tsx` | dashboard | `getPromos`, `getCannibalization`, `computeCannibalization` | Cannibalization workbench: pull-forward, cross-SKU, dollar adjustment |
| `/dashboard/elasticity` | `app/dashboard/elasticity/page.tsx` | dashboard | `getElasticityCurves`, `getElasticityCurve`, `fitElasticity`, `projectElasticityPoint` | Discount-depth elasticity curves + margin-optimal depth + point projector |
| `/dashboard/scenarios` | `app/dashboard/scenarios/page.tsx` | dashboard | `getScenarios`, `createScenario`, `updateScenario`, `deleteScenario`, `getPromos` | What-if scenario builder + projected contribution comparison |
| `/dashboard/alerts` | `app/dashboard/alerts/page.tsx` | dashboard | `getAlerts`, `scanAlerts`, `ackAlert`, `snoozeAlert`, `resolveAlert` | Money-losing promo kill list ranked by dollars destroyed |
| `/dashboard/retrospective` | `app/dashboard/retrospective/page.tsx` | dashboard | `getPromos`, `generatePromoRetro`, `generatePeriodRetro`, `getRecoverySummary` | CFO retrospective builder, period teardown, recovery summary |
| `/dashboard/cohorts` | `app/dashboard/cohorts/page.tsx` | dashboard | `getCohorts`, `buildCohort`, `deleteCohort`, `getSegments`, `createSegment`, `updateSegment`, `deleteSegment`, `getPromos` | Cohort builder + control/segment definitions |
| `/dashboard/channels` | `app/dashboard/channels/page.tsx` | dashboard | `getPromos`, `getChannelStats`, `computeChannelStats` | Channel attribution overlay per promo |
| `/dashboard/benchmarks` | `app/dashboard/benchmarks/page.tsx` | dashboard | `getBenchmarks`, `getBenchmarkVariance`, `createBenchmark`, `updateBenchmark`, `deleteBenchmark` | Targets + benchmark-vs-realized variance trend |
| `/dashboard/reports` | `app/dashboard/reports/page.tsx` | dashboard | `getReports`, `getReport`, `rerunReport`, `deleteReport` | Reports library + detail viewer |
| `/dashboard/activity` | `app/dashboard/activity/page.tsx` | dashboard | `getActivity` | Audit / activity feed |
| `/dashboard/notifications` | `app/dashboard/notifications/page.tsx` | dashboard | `getNotifications`, `markNotificationRead`, `markAllNotificationsRead` | Notifications list with read state |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | `getWorkspace`, `updateWorkspace`, `getBillingPlan`, `startCheckout`, `openBillingPortal` | Workspace config (fees, windows, thresholds) + billing |

---

## (e) DashboardLayout Sidebar Nav

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer. Sections group the dashboard pages:

- **Overview**
  - Dashboard → `/dashboard`
- **Data**
  - Ingestion → `/dashboard/data`
  - Column Mapping → `/dashboard/data/map`
  - Orders → `/dashboard/orders`
  - SKUs & COGS → `/dashboard/skus`
- **Promos**
  - Catalog → `/dashboard/promos`
  - Calendar → `/dashboard/calendar`
- **Analysis**
  - Incrementality → `/dashboard/incrementality`
  - Cannibalization → `/dashboard/cannibalization`
  - Elasticity → `/dashboard/elasticity`
  - Scenarios → `/dashboard/scenarios`
  - Cohorts & Segments → `/dashboard/cohorts`
  - Channels → `/dashboard/channels`
- **Truth & Action**
  - Kill List → `/dashboard/alerts`
  - Retrospective → `/dashboard/retrospective`
  - Benchmarks → `/dashboard/benchmarks`
  - Reports → `/dashboard/reports`
- **Account**
  - Activity → `/dashboard/activity`
  - Notifications → `/dashboard/notifications`
  - Settings → `/dashboard/settings`

> Promo detail (`/dashboard/promos/[id]`) is reached from the Catalog page (not a top-level nav item). Pricing/auth/landing are public, outside the dashboard chrome.

---

## Consistency Guarantees

- Every `lib/api.ts` method maps 1:1 to exactly one backend endpoint (path after `/api/proxy/` == path after `/api/v1/`).
- Every api method is consumed by at least one page (see column (d)).
- 25 route files, 90 api methods, 25 pages, 26 tables (24 app + plans + subscriptions).
- All money is integer cents end to end. All timestamps are timestamptz. Percentages/ratios are `real`.
- Backend: public reads, auth-gated writes via `authMiddleware` + `getUserId(c)`, zod on mutations, ownership checks (`user_id` match) on update/delete. Billing follows the webhook-inspector Stripe-optional-503 pattern with text `plan_id`.
