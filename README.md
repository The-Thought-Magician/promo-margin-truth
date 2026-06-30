# PromoMarginTruth

Reveal which marketing promotions actually made money after discount, incrementality, and cannibalization.

PromoMarginTruth is a DTC/subscription promo-profitability analytics layer. Top-line promo revenue lies: it conflates discounts that erode realized margin, sales that would have happened anyway at full price (low incrementality), and full-price demand pulled forward or stolen from adjacent SKUs (cannibalization). PromoMarginTruth ingests order-level promo data, computes a defensible per-promo P&L down to net contribution margin after incrementality and cannibalization, fits discount-depth elasticity curves to recommend the margin-optimal discount level, and emits a CFO-ready retrospective that names the money-losing promos to kill.

The product is deterministic analytics over uploaded, connected, or generated data. It ships with a sample-data seeder so a prospect can see a full BFCM teardown in one click.

See [docs/idea.md](docs/idea.md) for the full product specification and feature map.

## Features

- Data ingestion and connectors: CSV order-line upload, column mapping, connector stubs, built-in sample-data generator, validation, ingestion runs.
- Promo catalog and definitions: promo records, lifecycle status, tag mapping, cloning, owner assignment.
- Per-promo P&L: gross/net revenue, COGS, gross and contribution margin, margin-erosion, P&L waterfall.
- Incrementality estimation: pre-period and control-segment baselines, incremental units/revenue, confidence bands, method toggle.
- Cannibalization detection: pull-forward, cross-SKU cannibalization, would-have-bought signal, dollar adjustments.
- New-vs-existing customer split: first-order detection, CAC offset, split P&L.
- Discount-depth elasticity curves: deterministic curve fit, margin-optimal depth, scenario simulator.
- Money-losing promo alerts and kill list: negative-contribution flagging, severity ranking, recurring-loser detection.
- CFO-ready retrospective export: per-promo and per-period reports, dollar-recovery summary, JSON and print views.
- Promo calendar: overlap detection, projected vs realized contribution.
- SKU and COGS management: catalog, effective-dated overrides, margin profiles, bulk import.

## Stack

- Backend: Hono (Node, ESM, TypeScript), drizzle-orm over Neon Postgres, zod validation.
- Frontend: Next.js 16+, React 19+, TypeScript strict, Tailwind 4, App Router, located at `web/`.
- Auth: `@neondatabase/auth`; the Next.js proxy resolves the session server-side and injects `X-User-Id` to the backend.
- Package manager: pnpm everywhere.

## Local Development

Prerequisites: Node 22+, pnpm, a Neon (or Postgres) `DATABASE_URL`.

Backend:

```
cd backend
pnpm install
pnpm dev
```

The backend serves `/health` and the API under `/api/v1`, on port 3001 by default.

Frontend (in a separate terminal):

```
cd web
pnpm install
pnpm dev
```

The web app runs on port 3000 and proxies API calls to the backend.

## Environment Variables

Backend (`backend/.env`):

- `DATABASE_URL` — Neon/Postgres connection string (required).
- `PORT` — backend port (defaults to 3001 locally; Render injects 10000).
- `FRONTEND_URL` — allowed CORS origin (defaults to `http://localhost:3000`).
- `STRIPE_*` — optional; billing is wired but optional and returns 503 when unconfigured.

Web (`web/.env.local`):

- `NEXT_PUBLIC_API_URL` — backend base URL (e.g. `http://localhost:3001`).
- `@neondatabase/auth` configuration as required by the auth package.

## Billing

All features are free for signed-in users. Stripe billing is wired but optional and returns 503 when unconfigured.

## Deployment

- Backend deploys to Render via `render.yaml` (Node web service, `cd backend && pnpm install` / `cd backend && node --import tsx/esm src/index.ts`). Set `DATABASE_URL` and `FRONTEND_URL` as Render environment variables.
- Frontend deploys to Vercel with root directory `web`.
- `docker-compose.yml` brings backend and web up together for local container runs.
