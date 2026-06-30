'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Promo {
  id: string
  name: string
  promo_type?: string
  discount_depth_pct?: number
  status?: string
  campaign_tag?: string | null
  start_at?: string | null
  end_at?: string | null
}

interface CannibalizationResult {
  id: string
  promo_id: string
  pull_forward_units: number
  pull_forward_revenue_cents: number
  cross_sku_revenue_cents: number
  already_converting_pct: number
  dollar_adjustment_cents: number
  detail?: Record<string, unknown> | null
  computed_at?: string
}

const fmtMoney = (cents: number | null | undefined) => {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtPct = (n: number | null | undefined) => `${((n ?? 0) * (Math.abs(n ?? 0) <= 1 ? 100 : 1)).toFixed(1)}%`
const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US')

function statusTone(status?: string): 'neutral' | 'fuchsia' | 'green' | 'amber' | 'sky' {
  switch (status) {
    case 'active':
      return 'green'
    case 'analyzed':
      return 'fuchsia'
    case 'ended':
      return 'neutral'
    case 'planned':
      return 'sky'
    default:
      return 'neutral'
  }
}

export default function CannibalizationPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [results, setResults] = useState<Record<string, CannibalizationResult | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [computing, setComputing] = useState<Record<string, boolean>>({})
  const [bulkRunning, setBulkRunning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const list: Promo[] = await api.getPromos()
        if (cancelled) return
        setPromos(list)
        if (list.length && !selectedId) setSelectedId(list[0].id)
        // pull existing cannibalization results for each promo
        const entries = await Promise.all(
          list.map(async (p) => {
            try {
              const r = await api.getCannibalization(p.id)
              return [p.id, r as CannibalizationResult | null] as const
            } catch {
              return [p.id, null] as const
            }
          })
        )
        if (cancelled) return
        setResults(Object.fromEntries(entries))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load promos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function compute(promoId: string) {
    setComputing((c) => ({ ...c, [promoId]: true }))
    setActionError(null)
    try {
      const r: CannibalizationResult = await api.computeCannibalization(promoId)
      setResults((prev) => ({ ...prev, [promoId]: r }))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `Compute failed for ${promoId}`)
    } finally {
      setComputing((c) => ({ ...c, [promoId]: false }))
    }
  }

  async function computeAllVisible() {
    setBulkRunning(true)
    setActionError(null)
    try {
      for (const p of filtered) {
        try {
          const r: CannibalizationResult = await api.computeCannibalization(p.id)
          setResults((prev) => ({ ...prev, [p.id]: r }))
        } catch (e) {
          setActionError(e instanceof Error ? e.message : `Compute failed for ${p.name}`)
        }
      }
    } finally {
      setBulkRunning(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return promos.filter((p) => {
      if (statusFilter !== 'all' && (p.status ?? '') !== statusFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.campaign_tag ?? '').toLowerCase().includes(q) ||
        (p.promo_type ?? '').toLowerCase().includes(q)
      )
    })
  }, [promos, search, statusFilter])

  const selected = selectedId ? promos.find((p) => p.id === selectedId) ?? null : null
  const selectedResult = selectedId ? results[selectedId] ?? null : null

  const portfolio = useMemo(() => {
    const all = Object.values(results).filter(Boolean) as CannibalizationResult[]
    return {
      analyzed: all.length,
      pullForwardUnits: all.reduce((s, r) => s + (r.pull_forward_units ?? 0), 0),
      pullForwardRev: all.reduce((s, r) => s + (r.pull_forward_revenue_cents ?? 0), 0),
      crossSku: all.reduce((s, r) => s + (r.cross_sku_revenue_cents ?? 0), 0),
      adjustment: all.reduce((s, r) => s + (r.dollar_adjustment_cents ?? 0), 0),
    }
  }, [results])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    promos.forEach((p) => p.status && set.add(p.status))
    return Array.from(set).sort()
  }, [promos])

  if (loading) return <FullPageSpinner label="Loading cannibalization workbench..." />

  if (error) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardBody>
            <EmptyState
              title="Could not load promos"
              description={error}
              action={
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              }
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Promos analyzed" value={fmtNum(portfolio.analyzed)} hint={`${promos.length} total`} />
        <Stat label="Pull-forward units" value={fmtNum(portfolio.pullForwardUnits)} hint="Demand stolen from the future" />
        <Stat label="Cross-SKU revenue" value={fmtMoney(portfolio.crossSku)} hint="Shifted between SKUs" />
        <Stat
          label="Dollar adjustment"
          value={fmtMoney(portfolio.adjustment)}
          tone={portfolio.adjustment < 0 ? 'negative' : 'default'}
          hint="Net contribution correction"
        />
      </div>

      {actionError && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Promo list / workbench */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Promo workbench</h2>
              <p className="text-xs text-slate-400">Recompute pull-forward and cross-SKU effects per promo.</p>
            </div>
            <Button onClick={computeAllVisible} disabled={bulkRunning || filtered.length === 0}>
              {bulkRunning ? <Spinner className="mr-2" /> : null}
              Compute all visible
            </Button>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, tag, or type..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title={promos.length === 0 ? 'No promos yet' : 'No matches'}
                description={
                  promos.length === 0
                    ? 'Create promos and ingest order data, then compute cannibalization here.'
                    : 'Adjust your search or status filter.'
                }
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Promo</TH>
                    <TH className="text-right">Pull-fwd units</TH>
                    <TH className="text-right">Adjustment</TH>
                    <TH className="text-right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((p) => {
                    const r = results[p.id]
                    const active = p.id === selectedId
                    return (
                      <TR
                        key={p.id}
                        className={active ? 'cursor-pointer bg-fuchsia-950/20' : 'cursor-pointer'}
                        onClick={() => setSelectedId(p.id)}
                      >
                        <TD>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{p.name}</span>
                            <Badge tone={statusTone(p.status)}>{p.status ?? 'unknown'}</Badge>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {p.promo_type ?? 'promo'} · {fmtPct(p.discount_depth_pct)} off
                            {p.campaign_tag ? ` · ${p.campaign_tag}` : ''}
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums">
                          {r ? fmtNum(r.pull_forward_units) : <span className="text-slate-600">—</span>}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {r ? (
                            <span className={r.dollar_adjustment_cents < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                              {fmtMoney(r.dollar_adjustment_cents)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          <Button
                            variant="secondary"
                            className="px-3 py-1 text-xs"
                            disabled={!!computing[p.id]}
                            onClick={(e) => {
                              e.stopPropagation()
                              compute(p.id)
                            }}
                          >
                            {computing[p.id] ? <Spinner className="mr-1" /> : null}
                            {r ? 'Recompute' : 'Compute'}
                          </Button>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Detail panel */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Cannibalization detail</h2>
            <p className="text-xs text-slate-400">{selected ? selected.name : 'Select a promo'}</p>
          </CardHeader>
          <CardBody className="space-y-5">
            {!selected ? (
              <EmptyState title="No promo selected" description="Pick a promo from the workbench to inspect detail." />
            ) : !selectedResult ? (
              <EmptyState
                title="Not computed yet"
                description="Run cannibalization analysis to break down pull-forward, cross-SKU, and the dollar adjustment."
                action={
                  <Button disabled={!!computing[selected.id]} onClick={() => compute(selected.id)}>
                    {computing[selected.id] ? <Spinner className="mr-2" /> : null}
                    Compute now
                  </Button>
                }
              />
            ) : (
              <DetailBody result={selectedResult} promo={selected} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Cannibalization</h1>
      <p className="mt-1 text-sm text-slate-400">
        Strip out pull-forward and cross-SKU demand so promo lift reflects only genuinely incremental dollars.
      </p>
    </div>
  )
}

function DetailBody({ result, promo }: { result: CannibalizationResult; promo: Promo }) {
  // Visual breakdown: pull-forward rev vs cross-SKU rev as a stacked bar.
  const pull = Math.max(0, result.pull_forward_revenue_cents)
  const cross = Math.max(0, result.cross_sku_revenue_cents)
  const total = pull + cross || 1
  const pullPct = (pull / total) * 100
  const crossPct = (cross / total) * 100
  const convertingPct = Math.min(100, Math.max(0, (result.already_converting_pct ?? 0) * (Math.abs(result.already_converting_pct ?? 0) <= 1 ? 100 : 1)))

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Pull-forward units" value={fmtNum(result.pull_forward_units)} />
        <Stat label="Pull-forward rev" value={fmtMoney(result.pull_forward_revenue_cents)} />
        <Stat label="Cross-SKU rev" value={fmtMoney(result.cross_sku_revenue_cents)} />
        <Stat
          label="Dollar adjustment"
          value={fmtMoney(result.dollar_adjustment_cents)}
          tone={result.dollar_adjustment_cents < 0 ? 'negative' : 'positive'}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Revenue shift composition</span>
          <span>{fmtMoney(pull + cross)}</span>
        </div>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-fuchsia-500" style={{ width: `${pullPct}%` }} title={`Pull-forward ${fmtMoney(pull)}`} />
          <div className="h-full bg-sky-500" style={{ width: `${crossPct}%` }} title={`Cross-SKU ${fmtMoney(cross)}`} />
        </div>
        <div className="flex gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-fuchsia-500" /> Pull-forward {pullPct.toFixed(0)}%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-sky-500" /> Cross-SKU {crossPct.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Already-converting customers</span>
          <span>{convertingPct.toFixed(1)}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-amber-500" style={{ width: `${convertingPct}%` }} />
        </div>
        <p className="text-xs text-slate-500">
          Share of promo buyers who would have purchased at full price anyway — pure subsidy.
        </p>
      </div>

      <DetailJson detail={result.detail} />

      {result.computed_at && (
        <p className="text-xs text-slate-500">
          Computed {new Date(result.computed_at).toLocaleString()} for {promo.name}.
        </p>
      )}
    </>
  )
}

function DetailJson({ detail }: { detail?: Record<string, unknown> | null }) {
  if (!detail || Object.keys(detail).length === 0) return null
  const rows = Object.entries(detail).filter(([, v]) => typeof v !== 'object' || v === null)
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Breakdown detail</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k.replace(/_/g, ' ')}</dt>
            <dd className="text-right text-slate-200">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
