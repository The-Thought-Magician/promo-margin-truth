# PromoMarginTruth

> Reveal which marketing promotions actually made money after discount, incrementality, and cannibalization.

---

## Overview

PromoMarginTruth is a DTC/subscription promo-profitability analytics layer. Brands run promotions every cycle (sitewide sales, coupon codes, BOGO, bundle discounts, BFCM events) and judge them on revenue lift. That number lies. Top-line revenue during a promo conflates three things: (1) discounts that erode realized margin, (2) sales that would have happened anyway at full price (low incrementality), and (3) full-price demand pulled forward or stolen from adjacent SKUs and time windows (cannibalization). PromoMarginTruth ingests order-level promo data, computes a defensible per-promo P&L down to net contribution margin after incrementality and cannibalization, fits discount-depth elasticity curves to recommend the margin-optimal discount level, and emits a CFO-ready retrospective that names the money-losing promos to kill.

The product is deterministic analytics over uploaded, connected, or generated data. It ships with a sample-data seeder so a prospect can see a full BFCM teardown in one click. All features are free for signed-in users; Stripe billing is wired but optional (returns 503 when unconfigured).

## Problem

- Promo revenue spikes mask margin destruction. A 30%-off sitewide event can post record revenue while burning contribution margin once you subtract the discount given to customers who would have bought anyway.
- Nobody computes per-promo net contribution after incrementality and cannibalization, because it requires a baseline model, a control comparison, and SKU-level pull-forward detection that spreadsheets cannot sustain.
- Growth teams therefore rerun the same losing promos every cycle. The CFO sees blended margin compress and cannot point at the specific promo to cut.
- The sharp trigger moments (CFO margin review, post-BFCM retrospective, annual promo-calendar planning) arrive with no per-promo truth and high willingness to pay for a dollar-recovery story.

## Target Users

- **Primary buyer:** Head of Growth or DTC growth-finance lead who owns the promotional calendar and is accountable for contribution margin to the CFO.
- **Daily users:** Growth analysts and lifecycle marketers building and reviewing the promo calendar.
- **Stakeholders:** CFO / finance team consuming the retrospective; merchandising leads owning SKU-level margin.
- **Segment:** E-commerce and subscription DTC brands that run promotions every cycle, with order-level data (Shopify-style) and known per-SKU COGS.

## Why this is NOT an existing project

Near-neighbors and how PromoMarginTruth differs:

- **coupon-discount-engine** — *issues and manages* promo codes/discounts at checkout. It is an operational issuance engine. PromoMarginTruth never issues a discount; it is the *post-hoc profitability and incrementality analytics* on promos that already ran.
- **ab-test-analysis** — generic experiment significance testing (lift, p-values) on arbitrary metrics. PromoMarginTruth is promo-specific: it models discount depth, COGS, first-vs-repeat customer mix, pull-forward and cannibalization, and outputs net contribution margin in dollars, not abstract significance.
- **discount-leakage-ledger** — B2B list-price-vs-paid-price governance: tracks unauthorized discounting and margin leakage on negotiated deals. That is sales-ops governance on quote-to-cash. PromoMarginTruth is DTC marketing-promo incrementality/cannibalization, not B2B list-vs-paid policing.
- **channel-saturation-curve** — channel-level ad-spend efficiency and diminishing returns on paid media. It optimizes *media spend*, not *promotional discount profitability*.
- **creative-fatigue-radar** — ad-creative decay detection (when a creative stops performing). It is about creative refresh cadence, not promo P&L.

PromoMarginTruth occupies the unfilled slot: a deterministic per-promo incrementality + cannibalization + contribution-margin truth engine for DTC promotions, with discount-depth elasticity and a money-losing-promo kill list.

---

## Major Features

### 1. Data Ingestion & Connectors
- CSV upload of order lines (order_id, sku, qty, unit_price, discount_amount, cogs_unit, customer_id, order_ts, campaign_tag, channel).
- Column mapping UI to map arbitrary CSV headers to the canonical schema.
- Connector stubs for Shopify/order-platform style sources (manual-config, returns 503 if unconfigured; CSV is the supported path).
- Built-in sample-data generator that synthesizes a realistic brand (SKUs, baseline demand, several promos including a deliberately money-losing one) for instant demoability.
- Ingestion runs (batch records) with row counts, error rows, and validation summary.
- Per-row validation: negative price/qty checks, missing COGS flag, unmapped campaign tags.
- Re-ingest / replace dataset; soft-delete of an ingestion run.

### 2. Promo Catalog & Definitions
- Promo records: name, type (sitewide %, coupon code, BOGO, bundle, free-shipping, tiered), discount depth, start/end window, eligible SKUs/collections, channel scope, campaign tag mapping.
- Promo lifecycle status (planned, active, ended, analyzed).
- Tag-to-promo association so ingested order lines attach to the right promo.
- Promo cloning for recurring promos (BFCM year over year).
- Promo notes and owner assignment.

### 3. Per-Promo P&L
- Gross revenue, discount given, net revenue, COGS, gross margin, contribution margin in dollars and %.
- Realized margin % vs list margin % (margin erosion from discount).
- Units sold, average order value, average discount per order during promo.
- Promo cost components: discount dollars, incremental fulfillment/shipping subsidy (if free-shipping), platform fees (configurable %).
- P&L waterfall from gross revenue down to net contribution.

### 4. Incrementality Estimation
- Pre-period baseline: model expected demand from a configurable pre-promo window (trailing N days, same-day-of-week aware).
- Control-segment baseline: compare promo-eligible cohort vs a holdout/control segment (e.g. SKUs or regions not in the promo).
- Incremental units and incremental revenue = observed minus baseline.
- Incrementality ratio (incremental / total promo sales).
- Baseline confidence band (deterministic interval from pre-period variance).
- Method toggle: pre-period vs control vs blended.

### 5. Cannibalization Detection
- Pull-forward detection: full-price demand in the post-promo window that dipped below baseline (sales borrowed from the future).
- Cross-SKU cannibalization: promoted-SKU lift coinciding with non-promoted-SKU decline in the same window.
- Discount-of-the-already-converting: share of promo orders from customers who bought at full price recently (would-have-bought signal).
- Cannibalization dollar adjustment applied to net contribution.
- Pull-forward recovery window configuration.

### 6. New-vs-Existing Customer Split
- First-order-vs-repeat flag derived from customer order history.
- New-customer acquisition count and blended CAC offset from promo.
- Existing-customer discount subsidy (margin given to customers already loyal).
- New-customer downstream value indicator (first-order margin vs cohort baseline).
- Split P&L: contribution from net-new vs existing customers.

### 7. Discount-Depth Elasticity Curves
- Fit response of incremental units to discount depth across promos/SKUs (deterministic curve fit).
- Margin-optimal discount level: depth that maximizes net contribution.
- Elasticity coefficient and curve points for charting.
- Scenario simulator: "what net contribution at X% discount?".
- Per-SKU and per-collection elasticity.

### 8. Money-Losing Promo Alerts & Kill List
- Automatic flagging of promos with negative net contribution after incrementality + cannibalization.
- Severity ranking by dollars destroyed.
- Recurring-loser detection (same promo loses money across cycles).
- Kill-list with recommended action (kill, reduce depth to optimal, narrow SKU scope).
- Acknowledge / snooze / resolve alert states.

### 9. CFO-Ready Retrospective Export
- One-click promo retrospective report (per promo or per period).
- Dollar-recovery summary: total contribution recoverable by killing/optimizing flagged promos.
- Exportable as structured JSON and a print-friendly report view.
- Period retrospective (e.g. BFCM teardown) across all promos in a window.
- Executive summary headline metrics.

### 10. Promo Calendar
- Calendar view of planned/active/past promos with overlap detection.
- Overlap warning (two promos competing in the same window cannibalize each other).
- Calendar-level projected vs realized contribution.
- Drag-free planning entries (planned promos with projected P&L).

### 11. SKU & COGS Management
- SKU catalog with unit COGS, list price, collection grouping.
- COGS effective-dated overrides.
- Margin profile per SKU (list margin %).
- Bulk COGS import via CSV.
- Missing-COGS detection blocking accurate P&L.

### 12. Cohort & Segment Analysis
- Customer cohorts by acquisition promo.
- Segment definitions (region, channel, customer tier) used as control groups.
- Cohort retention/repeat indicator post-promo.
- Segment-level incrementality comparison.

### 13. Channel Attribution Overlay
- Per-channel promo performance (email, paid, organic, SMS).
- Channel-level incremental contribution.
- Channel mix shift during promo.

### 14. Scenario Planning & What-If
- Saved scenarios: change discount depth, SKU scope, duration, channel.
- Projected net contribution per scenario using fitted elasticity.
- Scenario comparison table.

### 15. Benchmarks & Targets
- Contribution-margin targets per promo/period.
- Benchmark realized margin vs target.
- Trend of realized margin across cycles.

### 16. Alerts & Notifications
- In-app notifications for new money-losing flags, ingestion completion, recurring losers.
- Per-user read/unread state.
- Threshold configuration (flag when net contribution < $X or margin < Y%).

### 17. Dashboards & KPI Overview
- Portfolio dashboard: total promos, net contribution, dollars destroyed, recoverable dollars.
- Top winners / top losers leaderboard.
- Realized-margin trend chart.

### 18. Reports Library
- Saved/generated reports list (retrospectives, P&L exports).
- Report detail view with full P&L, incrementality, cannibalization breakdown.
- Re-run report against latest data.

### 19. Audit Log & Activity
- Activity feed of user actions (ingest, promo edits, COGS changes, report generation).
- Per-entity change history.

### 20. Settings & Configuration
- Workspace settings: platform fee %, default pre-period window, pull-forward window, currency.
- Notification thresholds.
- Member-visible config (single-tenant per user/workspace).

### 21. Billing & Plans
- Free plan (all features), optional Pro plan via Stripe.
- Plan view, checkout, portal (503 when Stripe unconfigured).

### 22. Sample Data & Onboarding
- One-click seed of a demo brand with a known money-losing promo.
- Guided first-run checklist (upload data, map columns, set COGS, run analysis).

---

## Data Model (tables)

- `workspaces` — per-user workspace/config (platform_fee_pct, pre_period_days, pull_forward_days, currency).
- `skus` — SKU catalog (sku_code, name, collection, list_price, cogs_unit).
- `cogs_overrides` — effective-dated COGS overrides per SKU.
- `promos` — promo definitions (name, type, discount_depth, start/end, status, campaign_tag, channel_scope, eligible_skus, owner, notes).
- `ingestion_runs` — upload batches (filename, row_count, error_count, status, summary).
- `order_lines` — ingested order line items (order_id, sku_code, qty, unit_price, discount_amount, cogs_unit, customer_id, order_ts, campaign_tag, channel, is_first_order, promo_id).
- `column_mappings` — saved CSV header→canonical mappings.
- `promo_pnl` — computed per-promo P&L snapshots (gross_rev, discount, net_rev, cogs, contribution, realized_margin_pct, units).
- `incrementality_results` — incrementality estimates (method, baseline_units, incremental_units, incremental_rev, incrementality_ratio, confidence_low/high).
- `cannibalization_results` — cannibalization estimates (pull_forward_units, pull_forward_rev, cross_sku_rev, dollar_adjustment).
- `customer_splits` — new-vs-existing split per promo (new_count, existing_count, new_contribution, existing_contribution).
- `elasticity_curves` — fitted elasticity (scope, scope_id, coefficient, optimal_depth, curve_points jsonb).
- `scenarios` — what-if scenarios (params jsonb, projected_contribution).
- `promo_alerts` — money-losing flags (promo_id, severity, dollars_destroyed, recommendation, status).
- `cohorts` — acquisition cohorts (promo_id, customer_ids, repeat_rate).
- `segments` — control/segment definitions (kind, criteria jsonb).
- `channel_stats` — per-channel promo stats (channel, incremental_contribution, mix_pct).
- `benchmarks` — targets per promo/period (target_margin_pct, target_contribution).
- `reports` — generated reports (kind, scope, period, payload jsonb).
- `notifications` — per-user notifications (kind, title, body, read).
- `activity_log` — audit entries (action, entity, entity_id, detail jsonb).
- `calendar_entries` — promo-calendar planning entries (promo_id or planned name, window, projected_contribution).
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription state.

## API Surface (high level)

- `/workspace` — get/update workspace config.
- `/skus` — CRUD SKUs, bulk import, missing-COGS report.
- `/cogs` — COGS overrides CRUD.
- `/promos` — CRUD promos, clone, status transitions.
- `/ingest` — upload, list runs, run detail, delete run, sample-seed.
- `/orders` — list/query ingested order lines, summary.
- `/mappings` — saved column mappings CRUD.
- `/pnl` — per-promo P&L compute + fetch.
- `/incrementality` — compute + fetch incrementality.
- `/cannibalization` — compute + fetch cannibalization.
- `/splits` — new-vs-existing split.
- `/elasticity` — fit curves, optimal depth, scenario point.
- `/scenarios` — what-if CRUD + project.
- `/alerts` — money-losing flags list, ack/snooze/resolve.
- `/retrospective` — generate CFO retrospective, period teardown.
- `/calendar` — calendar entries + overlap detection.
- `/cohorts` — cohort analysis.
- `/segments` — control segment CRUD.
- `/channels` — channel attribution stats.
- `/benchmarks` — targets CRUD + variance.
- `/dashboard` — portfolio KPIs, winners/losers.
- `/reports` — reports library.
- `/notifications` — list, mark read, thresholds.
- `/activity` — audit feed.
- `/billing` — plan, checkout, portal, webhook.

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — plans.

Dashboard:
5. `/dashboard` — portfolio KPI overview, winners/losers.
6. `/dashboard/data` — ingestion: upload, runs list.
7. `/dashboard/data/map` — CSV column mapping.
8. `/dashboard/orders` — ingested order-lines explorer.
9. `/dashboard/skus` — SKU & COGS management.
10. `/dashboard/promos` — promo catalog list.
11. `/dashboard/promos/[id]` — promo detail: P&L, incrementality, cannibalization, splits.
12. `/dashboard/calendar` — promo calendar with overlap detection.
13. `/dashboard/incrementality` — incrementality workbench.
14. `/dashboard/cannibalization` — cannibalization workbench.
15. `/dashboard/elasticity` — discount-depth elasticity curves + optimizer.
16. `/dashboard/scenarios` — what-if scenario planning.
17. `/dashboard/alerts` — money-losing promo kill list.
18. `/dashboard/retrospective` — CFO-ready retrospective builder/export.
19. `/dashboard/cohorts` — cohort & segment analysis.
20. `/dashboard/channels` — channel attribution overlay.
21. `/dashboard/benchmarks` — targets & benchmark trends.
22. `/dashboard/reports` — reports library.
23. `/dashboard/activity` — audit log / activity feed.
24. `/dashboard/notifications` — notifications.
25. `/dashboard/settings` — workspace settings, thresholds, billing.
