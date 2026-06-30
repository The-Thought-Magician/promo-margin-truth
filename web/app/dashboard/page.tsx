'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'

interface Kpis {
  promo_count?: number
  active_count?: number
  total_contribution_cents?: number
  dollars_destroyed_cents?: number
  recoverable_cents?: number
  avg_realized_margin_pct?: number
  losing_count?: number
}

interface LeaderRow {
  promo_id: string
  name?: string
  contribution_cents?: number
  realized_margin_pct?: number
}

interface TrendPoint {
  promo_id?: string
  name?: string
  end_at?: string
  realized_margin_pct?: number
  contribution_cents?: number
}

interface RecoveryByPromo {
  promo_id: string
  name?: string
  recoverable_cents?: number
  recommendation?: string
}

const fmtCents = (c?: number) => {
  const v = (c ?? 0) / 100
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
const fmtPct = (p?: number) => (p == null ? '—' : `${(p * (Math.abs(p) <= 1 ? 100 : 1)).toFixed(1)}%`)

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<Kpis>({})
  const [winners, setWinners] = useState<LeaderRow[]>([])
  const [losers, setLosers] = useState<LeaderRow[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [recoverable, setRecoverable] = useState(0)
  const [recoveryRows, setRecoveryRows] = useState<RecoveryByPromo[]>([])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [overview, leaderboard, marginTrend, recovery] = await Promise.all([
        api.getDashboardOverview().catch(() => ({})),
        api.getDashboardLeaderboard().catch(() => ({})),
        api.getMarginTrend().catch(() => ({})),
        api.getRecoverySummary().catch(() => ({})),
      ])
      setKpis(overview?.kpis ?? overview ?? {})
      setWinners(leaderboard?.winners ?? [])
      setLosers(leaderboard?.losers ?? [])
      setTrend(marginTrend?.points ?? [])
      setRecoverable(recovery?.recoverable_cents ?? 0)
      setRecoveryRows(recovery?.by_promo ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <FullPageSpinner label="Loading portfolio truth..." />

  const empty =
    !kpis.promo_count &&
    winners.length === 0 &&
    losers.length === 0 &&
    trend.length === 0 &&
    recoveryRows.length === 0

  const trendVals = trend.map((p) => p.realized_margin_pct ?? 0)
  const trendMin = Math.min(0, ...trendVals)
  const trendMax = Math.max(0.001, ...trendVals)
  const norm = (v: number) => {
    const range = trendMax - trendMin || 1
    return ((v - trendMin) / range) * 100
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Portfolio Truth</h1>
          <p className="mt-1 text-sm text-slate-400">
            The real margin contribution of your trade-promotion portfolio, after discounts, COGS, and fees.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>Refresh</Button>
          <Link href="/dashboard/alerts">
            <Button variant="primary">View Kill List</Button>
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {error} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      {empty && !error ? (
        <EmptyState
          icon="📊"
          title="No promo data yet"
          description="Seed sample data or upload your orders to compute the real margin truth across your promotions."
          action={
            <Link href="/dashboard/data">
              <Button>Add data</Button>
            </Link>
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Promotions" value={kpis.promo_count ?? 0} hint={`${kpis.active_count ?? 0} active`} />
            <Stat
              label="Net Contribution"
              value={fmtCents(kpis.total_contribution_cents)}
              tone={(kpis.total_contribution_cents ?? 0) >= 0 ? 'positive' : 'negative'}
              hint="After discounts, COGS, fees"
            />
            <Stat
              label="Dollars Destroyed"
              value={fmtCents(kpis.dollars_destroyed_cents)}
              tone="negative"
              hint={`${kpis.losing_count ?? losers.filter((l) => (l.contribution_cents ?? 0) < 0).length} money-losing promos`}
            />
            <Stat
              label="Recoverable"
              value={fmtCents(kpis.recoverable_cents ?? recoverable)}
              tone="positive"
              hint="If losing promos were killed"
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Top Winners</h2>
                <Badge tone="green">By contribution</Badge>
              </CardHeader>
              <CardBody className="p-0">
                {winners.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-500">No winning promos yet.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Promo</TH>
                        <TH className="text-right">Contribution</TH>
                        <TH className="text-right">Margin</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {winners.map((w) => (
                        <TR key={w.promo_id}>
                          <TD>
                            <Link href={`/dashboard/promos/${w.promo_id}`} className="text-fuchsia-300 hover:text-fuchsia-200">
                              {w.name ?? w.promo_id}
                            </Link>
                          </TD>
                          <TD className="text-right font-semibold text-emerald-400">{fmtCents(w.contribution_cents)}</TD>
                          <TD className="text-right text-slate-300">{fmtPct(w.realized_margin_pct)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Top Losers</h2>
                <Badge tone="red">Money-losing</Badge>
              </CardHeader>
              <CardBody className="p-0">
                {losers.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-500">No losing promos. Healthy portfolio.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Promo</TH>
                        <TH className="text-right">Contribution</TH>
                        <TH className="text-right">Margin</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {losers.map((l) => (
                        <TR key={l.promo_id}>
                          <TD>
                            <Link href={`/dashboard/promos/${l.promo_id}`} className="text-fuchsia-300 hover:text-fuchsia-200">
                              {l.name ?? l.promo_id}
                            </Link>
                          </TD>
                          <TD className="text-right font-semibold text-rose-400">{fmtCents(l.contribution_cents)}</TD>
                          <TD className="text-right text-slate-300">{fmtPct(l.realized_margin_pct)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </section>

          <section className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Realized Margin Trend</h2>
                <p className="mt-0.5 text-xs text-slate-500">Realized margin % across promotions, ordered by end date.</p>
              </CardHeader>
              <CardBody>
                {trend.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">No completed promotions to trend yet.</p>
                ) : (
                  <div>
                    <div className="flex h-48 items-end gap-1">
                      {trend.map((p, i) => {
                        const v = p.realized_margin_pct ?? 0
                        const h = Math.max(2, norm(v))
                        const neg = v < 0
                        return (
                          <div key={p.promo_id ?? i} className="group relative flex flex-1 flex-col items-center justify-end">
                            <div
                              className={`w-full rounded-t ${neg ? 'bg-rose-500/70' : 'bg-fuchsia-500/70'} transition-all group-hover:opacity-100`}
                              style={{ height: `${h}%` }}
                            />
                            <div className="pointer-events-none absolute -top-9 z-10 hidden whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 group-hover:block">
                              {p.name ?? 'Promo'}: {fmtPct(p.realized_margin_pct)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-slate-600">
                      <span>{trend[0]?.name ?? ''}</span>
                      <span>{trend[trend.length - 1]?.name ?? ''}</span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Recoverable Dollars</h2>
                <Badge tone="amber">Action</Badge>
              </CardHeader>
              <CardBody>
                <div className="text-3xl font-black text-emerald-400">{fmtCents(recoverable)}</div>
                <p className="mt-1 text-xs text-slate-500">Contribution recoverable from open alerts.</p>
                <div className="mt-4 space-y-2">
                  {recoveryRows.length === 0 ? (
                    <p className="text-sm text-slate-500">Nothing flagged for recovery.</p>
                  ) : (
                    recoveryRows.slice(0, 6).map((r) => (
                      <div key={r.promo_id} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                        <Link href={`/dashboard/promos/${r.promo_id}`} className="truncate text-sm text-slate-300 hover:text-white">
                          {r.name ?? r.promo_id}
                        </Link>
                        <span className="ml-2 shrink-0 text-sm font-semibold text-emerald-400">{fmtCents(r.recoverable_cents)}</span>
                      </div>
                    ))
                  )}
                </div>
                <Link href="/dashboard/retrospective" className="mt-4 block">
                  <Button variant="secondary" className="w-full">Build retrospective</Button>
                </Link>
              </CardBody>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
