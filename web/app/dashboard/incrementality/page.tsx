'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Promo {
  id: string
  name: string
  status: string
  promo_type: string
  discount_depth_pct: number
  start_at?: string
  end_at?: string
}

interface Incrementality {
  id: string
  promo_id: string
  method: string
  baseline_units: number
  observed_units: number
  incremental_units: number
  incremental_revenue_cents: number
  incrementality_ratio: number
  confidence_low: number
  confidence_high: number
  computed_at?: string
}

const METHODS = [
  { value: 'pre_period', label: 'Pre-period' },
  { value: 'control', label: 'Control group' },
  { value: 'blended', label: 'Blended' },
]

const money = (cents?: number | null) =>
  cents == null || Number.isNaN(cents)
    ? '—'
    : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US'))
const ratioPct = (r?: number | null) => (r == null || Number.isNaN(r) ? '—' : `${(r * 100).toFixed(0)}%`)
const methodLabel = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m

export default function IncrementalityWorkbenchPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Incrementality[]>([])
  const [method, setMethod] = useState('pre_period')

  const [loading, setLoading] = useState(true)
  const [loadingResults, setLoadingResults] = useState(false)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // load promos once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const p = await api.getPromos()
        if (cancelled) return
        const list: Promo[] = Array.isArray(p) ? p : []
        setPromos(list)
        if (list.length) setSelectedId(list[0].id)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load promos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const loadResults = useCallback(async (promoId: string) => {
    setLoadingResults(true)
    setError(null)
    try {
      const r = await api.getIncrementality(promoId)
      setResults(Array.isArray(r) ? r : [])
    } catch (e) {
      setResults([])
      setError(e instanceof Error ? e.message : 'Failed to load incrementality results')
    } finally {
      setLoadingResults(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadResults(selectedId)
    else setResults([])
  }, [selectedId, loadResults])

  const compute = async () => {
    if (!selectedId) return
    setComputing(true)
    setError(null)
    try {
      await api.computeIncrementality(selectedId, method)
      await loadResults(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compute failed')
    } finally {
      setComputing(false)
    }
  }

  const selected = promos.find((p) => p.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return promos
    return promos.filter((p) => p.name.toLowerCase().includes(q) || p.promo_type?.toLowerCase().includes(q))
  }, [promos, search])

  // result currently shown for the selected method (if any)
  const current = results.find((r) => r.method === method) ?? null

  if (loading) return <FullPageSpinner label="Loading workbench..." />

  if (promos.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No promos to analyze"
          description="Create a promo and ingest order data, then return here to measure incremental lift."
          action={<Button onClick={() => (window.location.href = '/dashboard/promos')}>Go to catalog</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      <Header />

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Promo picker */}
        <Card className="self-start">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Promos</h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </CardHeader>
          <CardBody className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-slate-500">No matches</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    p.id === selectedId ? 'bg-fuchsia-600/20 text-fuchsia-200 ring-1 ring-fuchsia-700' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{p.promo_type} · {p.discount_depth_pct}% off</div>
                </button>
              ))
            )}
          </CardBody>
        </Card>

        {/* Workbench */}
        <div className="space-y-6">
          {/* Method toggle + compute */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">{selected?.name ?? 'Select a promo'}</h2>
                <p className="text-xs text-slate-500">Choose a baseline method, then compute incremental lift.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
                  {METHODS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setMethod(m.value)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        method === m.value ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <Button onClick={compute} disabled={computing || !selectedId}>
                  {computing ? <Spinner className="mr-2" /> : null}
                  Compute
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {loadingResults ? (
                <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading results…</div>
              ) : !current ? (
                <EmptyState
                  title={`No ${methodLabel(method)} result yet`}
                  description="Run compute to estimate baseline vs observed units with a confidence band."
                  action={<Button onClick={compute} disabled={computing || !selectedId}>Compute now</Button>}
                />
              ) : (
                <BaselineVsObserved r={current} />
              )}
            </CardBody>
          </Card>

          {/* All methods comparison */}
          {results.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Method comparison</h2>
                <p className="text-xs text-slate-500">All computed baselines for this promo.</p>
              </CardHeader>
              <CardBody className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Method</TH>
                      <TH className="text-right">Baseline</TH>
                      <TH className="text-right">Observed</TH>
                      <TH className="text-right">Incremental</TH>
                      <TH className="text-right">Incr. rev</TH>
                      <TH className="text-right">Ratio</TH>
                      <TH className="text-right">CI band</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {results.map((r) => (
                      <TR
                        key={r.id ?? r.method}
                        className={r.method === method ? 'bg-fuchsia-600/5' : ''}
                      >
                        <TD><Badge tone={r.method === method ? 'fuchsia' : 'neutral'}>{methodLabel(r.method)}</Badge></TD>
                        <TD className="text-right tabular-nums">{num(r.baseline_units)}</TD>
                        <TD className="text-right tabular-nums">{num(r.observed_units)}</TD>
                        <TD className="text-right tabular-nums text-emerald-300">{num(r.incremental_units)}</TD>
                        <TD className="text-right tabular-nums text-emerald-300">{money(r.incremental_revenue_cents)}</TD>
                        <TD className="text-right tabular-nums">{ratioPct(r.incrementality_ratio)}</TD>
                        <TD className="text-right tabular-nums text-slate-400">{num(r.confidence_low)}–{num(r.confidence_high)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Incrementality Workbench</h1>
      <p className="mt-1 text-sm text-slate-400">
        Separate true lift from sales that would have happened anyway. Toggle baseline methods and read the confidence band.
      </p>
    </div>
  )
}

function BaselineVsObserved({ r }: { r: Incrementality }) {
  const scaleMax = Math.max(r.observed_units, r.baseline_units, r.confidence_high, 1)
  const w = (v: number) => `${Math.max((Math.max(v, 0) / scaleMax) * 100, 0)}%`
  const lift = r.baseline_units > 0 ? ((r.observed_units - r.baseline_units) / r.baseline_units) * 100 : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Baseline units" value={num(r.baseline_units)} />
        <Stat label="Observed units" value={num(r.observed_units)} />
        <Stat label="Incremental units" value={num(r.incremental_units)} tone="positive" hint={lift == null ? undefined : `${lift >= 0 ? '+' : ''}${lift.toFixed(0)}% lift`} />
        <Stat label="Incremental revenue" value={money(r.incremental_revenue_cents)} tone="positive" hint={`ratio ${ratioPct(r.incrementality_ratio)}`} />
      </div>

      {/* Bars */}
      <div className="space-y-3">
        <BarRow label="Baseline" tone="bg-slate-600" width={w(r.baseline_units)} right={num(r.baseline_units)} />
        <BarRow label="Observed" tone="bg-fuchsia-600" width={w(r.observed_units)} right={num(r.observed_units)} />

        {/* Confidence band relative to scale */}
        <div className="grid grid-cols-[90px_1fr_120px] items-center gap-3">
          <div className="text-xs text-slate-400">Confidence</div>
          <div className="relative h-5 rounded bg-slate-950">
            {/* observed marker */}
            <div className="absolute top-0 h-5 w-px bg-fuchsia-400" style={{ left: w(r.observed_units) }} />
            <div
              className="absolute top-1 h-3 rounded bg-sky-700/50 ring-1 ring-sky-600/40"
              style={{
                left: w(r.confidence_low),
                width: `${Math.max((Math.max(r.confidence_high - r.confidence_low, 0) / scaleMax) * 100, 1)}%`,
              }}
            />
          </div>
          <div className="text-right text-xs tabular-nums text-slate-400">{num(r.confidence_low)} – {num(r.confidence_high)}</div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Method <span className="text-slate-300">{methodLabel(r.method)}</span>
        {r.computed_at ? <> · computed {new Date(r.computed_at).toLocaleString('en-US')}</> : null}
      </p>
    </div>
  )
}

function BarRow({ label, tone, width, right }: { label: string; tone: string; width: string; right: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr_120px] items-center gap-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="relative h-5 rounded bg-slate-950">
        <div className={`absolute top-0 h-5 rounded ${tone}`} style={{ width }} />
      </div>
      <div className="text-right text-xs font-medium tabular-nums text-slate-200">{right}</div>
    </div>
  )
}
