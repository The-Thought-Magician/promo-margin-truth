'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Promo {
  id: string
  name: string
  promo_type: string
  discount_depth_pct: number
  start_at: string | null
  end_at: string | null
  status: string
  campaign_tag: string | null
}

interface RecoveryByPromo {
  promo_id: string
  promo_name?: string
  recoverable_cents: number
}

interface RecoverySummary {
  recoverable_cents: number
  by_promo: RecoveryByPromo[]
}

interface ReportPayload {
  id: string
  kind: string
  scope: string
  scope_id: string | null
  title: string
  period_start: string | null
  period_end: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

function money(cents: number): string {
  const dollars = (cents ?? 0) / 100
  const abs = Math.abs(dollars)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${dollars < 0 ? '-' : ''}$${formatted}`
}

function statusTone(status: string): 'green' | 'amber' | 'fuchsia' | 'neutral' {
  switch (status) {
    case 'analyzed':
      return 'green'
    case 'active':
      return 'fuchsia'
    case 'ended':
      return 'amber'
    default:
      return 'neutral'
  }
}

function PayloadView({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload || typeof payload !== 'object') {
    return <p className="text-sm text-slate-500">No report payload.</p>
  }
  const entries = Object.entries(payload)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {entries.map(([k, v]) => {
        const isMoney = /cents$/.test(k)
        const display =
          v == null
            ? '—'
            : isMoney && typeof v === 'number'
              ? money(v)
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v)
        return (
          <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{k.replace(/_/g, ' ')}</div>
            <div className="mt-0.5 break-words text-sm text-slate-200">{display}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function RetrospectivePage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [recovery, setRecovery] = useState<RecoverySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [promoId, setPromoId] = useState('')
  const [genPromoBusy, setGenPromoBusy] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [periodStart, setPeriodStart] = useState(monthAgo)
  const [periodEnd, setPeriodEnd] = useState(today)
  const [periodTitle, setPeriodTitle] = useState('Q-end promo teardown')
  const [genPeriodBusy, setGenPeriodBusy] = useState(false)

  const [result, setResult] = useState<ReportPayload | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, rec] = await Promise.all([api.getPromos(), api.getRecoverySummary()])
      const list: Promo[] = Array.isArray(p) ? p : []
      setPromos(list)
      setRecovery(rec ?? { recoverable_cents: 0, by_promo: [] })
      if (list.length > 0) setPromoId((prev) => prev || list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load retrospective data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function genPromo() {
    if (!promoId) return
    setGenPromoBusy(true)
    setError(null)
    try {
      const report = await api.generatePromoRetro(promoId)
      setResult(report)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate promo retrospective')
    } finally {
      setGenPromoBusy(false)
    }
  }

  async function genPeriod() {
    if (!periodStart || !periodEnd) {
      setError('Pick a start and end date for the period teardown.')
      return
    }
    setGenPeriodBusy(true)
    setError(null)
    try {
      const report = await api.generatePeriodRetro({
        start: periodStart,
        end: periodEnd,
        title: periodTitle.trim() || 'Period teardown',
      })
      setResult(report)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate period teardown')
    } finally {
      setGenPeriodBusy(false)
    }
  }

  const recByPromo = useMemo(() => {
    const rows = recovery?.by_promo ?? []
    return [...rows].sort((a, b) => b.recoverable_cents - a.recoverable_cents)
  }, [recovery])

  const maxRec = useMemo(() => Math.max(1, ...recByPromo.map((r) => r.recoverable_cents ?? 0)), [recByPromo])

  const promoName = (id: string) => promos.find((p) => p.id === id)?.name ?? id.slice(0, 8)

  if (loading) return <FullPageSpinner label="Loading retrospective workspace..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">CFO Retrospective</h1>
        <p className="mt-1 text-sm text-slate-400">
          Build per-promo teardowns and period reviews, and see exactly how much contribution is recoverable.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Recoverable contribution"
          value={money(recovery?.recoverable_cents ?? 0)}
          tone={(recovery?.recoverable_cents ?? 0) > 0 ? 'positive' : 'default'}
          hint="From open alerts"
        />
        <Stat label="Promos in scope" value={promos.length} />
        <Stat label="Recovery lines" value={recByPromo.length} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Per-promo retrospective</h2>
            <p className="mt-1 text-xs text-slate-400">Generate a full teardown for a single promotion.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            {promos.length === 0 ? (
              <EmptyState title="No promos yet" description="Create a promo before building a retrospective." />
            ) : (
              <>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Promo</span>
                  <select
                    value={promoId}
                    onChange={(e) => setPromoId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  >
                    {promos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.status})
                      </option>
                    ))}
                  </select>
                </label>
                <Button onClick={genPromo} disabled={genPromoBusy || !promoId}>
                  {genPromoBusy ? <Spinner className="mr-2" /> : null}
                  {genPromoBusy ? 'Generating...' : 'Generate promo retro'}
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Period teardown</h2>
            <p className="mt-1 text-xs text-slate-400">Roll up every promo inside a date window.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Title</span>
              <input
                value={periodTitle}
                onChange={(e) => setPeriodTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Start</span>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">End</span>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                />
              </label>
            </div>
            <Button onClick={genPeriod} disabled={genPeriodBusy}>
              {genPeriodBusy ? <Spinner className="mr-2" /> : null}
              {genPeriodBusy ? 'Building...' : 'Build period teardown'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {result && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{result.title}</h2>
              <p className="mt-1 text-xs text-slate-400">
                {result.kind} · {result.scope}
                {result.period_start && result.period_end
                  ? ` · ${result.period_start.slice(0, 10)} → ${result.period_end.slice(0, 10)}`
                  : ''}
              </p>
            </div>
            <Badge tone="fuchsia">generated</Badge>
          </CardHeader>
          <CardBody>
            <PayloadView payload={result.payload} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Recovery summary</h2>
          <p className="mt-1 text-xs text-slate-400">Recoverable contribution per promo, ranked.</p>
        </CardHeader>
        <CardBody className="p-0">
          {recByPromo.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nothing to recover"
                description="No open alerts are currently carrying recoverable contribution."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Promo</TH>
                  <TH>Status</TH>
                  <TH>Recoverable</TH>
                  <TH className="w-1/3">Share</TH>
                </TR>
              </THead>
              <TBody>
                {recByPromo.map((r) => {
                  const promo = promos.find((p) => p.id === r.promo_id)
                  const pct = Math.round(((r.recoverable_cents ?? 0) / maxRec) * 100)
                  return (
                    <TR key={r.promo_id}>
                      <TD className="font-medium text-slate-200">{r.promo_name ?? promoName(r.promo_id)}</TD>
                      <TD>{promo ? <Badge tone={statusTone(promo.status)}>{promo.status}</Badge> : <span className="text-slate-500">—</span>}</TD>
                      <TD className="font-semibold text-emerald-300">{money(r.recoverable_cents)}</TD>
                      <TD>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-fuchsia-500" style={{ width: `${pct}%` }} />
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
