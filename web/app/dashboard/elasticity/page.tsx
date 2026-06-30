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

interface CurvePoint {
  depth_pct: number
  contribution_cents: number
}

interface ElasticityCurve {
  id: string
  scope: string
  scope_id: string
  coefficient: number
  optimal_depth_pct: number
  optimal_contribution_cents: number
  curve_points: CurvePoint[] | null
  computed_at?: string
}

const fmtMoney = (cents: number | null | undefined) => {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const asPct = (n: number | null | undefined) => {
  const v = n ?? 0
  return Math.abs(v) <= 1 ? v * 100 : v
}
const fmtPct = (n: number | null | undefined) => `${asPct(n).toFixed(1)}%`

export default function ElasticityPage() {
  const [curves, setCurves] = useState<ElasticityCurve[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Fit form
  const [fitScope, setFitScope] = useState('global')
  const [fitScopeId, setFitScopeId] = useState('global')
  const [fitting, setFitting] = useState(false)

  // Point projector
  const [pointDepth, setPointDepth] = useState(20)
  const [pointResult, setPointResult] = useState<CurvePoint | null>(null)
  const [projecting, setProjecting] = useState(false)

  const keyOf = (c: { scope: string; scope_id: string }) => `${c.scope}:${c.scope_id}`

  async function loadCurves(preserveSelection = false) {
    setLoading(true)
    setError(null)
    try {
      const list: ElasticityCurve[] = await api.getElasticityCurves()
      setCurves(list)
      if (!preserveSelection || !selectedKey) {
        if (list.length) setSelectedKey(keyOf(list[0]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load elasticity curves')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCurves()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(
    () => curves.find((c) => keyOf(c) === selectedKey) ?? null,
    [curves, selectedKey]
  )

  async function fit() {
    const scope = fitScope.trim()
    const scope_id = fitScopeId.trim()
    if (!scope || !scope_id) {
      setActionError('Scope and scope id are required.')
      return
    }
    setFitting(true)
    setActionError(null)
    try {
      const curve: ElasticityCurve = await api.fitElasticity({ scope, scope_id })
      setSelectedKey(keyOf(curve))
      setPointResult(null)
      await loadCurves(true)
      setSelectedKey(keyOf(curve))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Fit failed')
    } finally {
      setFitting(false)
    }
  }

  async function project() {
    if (!selected) return
    setProjecting(true)
    setActionError(null)
    try {
      // Match the unit the fitted curve uses: if its points/optimal are stored as
      // fractions (<=1) send a fraction, otherwise send a whole percent.
      const fractionUnit = Math.abs(selected.optimal_depth_pct ?? 0) <= 1
      const r = await api.projectElasticityPoint({
        scope: selected.scope,
        scope_id: selected.scope_id,
        depth_pct: fractionUnit ? pointDepth / 100 : pointDepth,
      })
      setPointResult({ depth_pct: r.depth_pct, contribution_cents: r.contribution_cents })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Projection failed')
    } finally {
      setProjecting(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading elasticity curves..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Discount-depth elasticity</h1>
        <p className="mt-1 text-sm text-slate-400">
          Fit contribution as a function of discount depth, find the margin-optimal depth, and project any point on the curve.
        </p>
      </div>

      {error && (
        <Card>
          <CardBody>
            <EmptyState
              title="Could not load curves"
              description={error}
              action={
                <Button variant="secondary" onClick={() => loadCurves()}>
                  Retry
                </Button>
              }
            />
          </CardBody>
        </Card>
      )}

      {actionError && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {actionError}
        </div>
      )}

      {/* Fit form */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Fit a curve</h2>
          <p className="text-xs text-slate-400">
            Scope is typically <code className="text-fuchsia-300">global</code>, <code className="text-fuchsia-300">collection</code>, or{' '}
            <code className="text-fuchsia-300">sku</code>. Use scope id <code className="text-fuchsia-300">global</code> for a portfolio-wide fit.
          </p>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Scope</span>
              <input
                value={fitScope}
                onChange={(e) => setFitScope(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Scope id</span>
              <input
                value={fitScopeId}
                onChange={(e) => setFitScopeId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </label>
            <Button onClick={fit} disabled={fitting}>
              {fitting ? <Spinner className="mr-2" /> : null}
              Fit curve
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* Curve list */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Fitted curves</h2>
            <p className="text-xs text-slate-400">{curves.length} fitted</p>
          </CardHeader>
          <CardBody>
            {curves.length === 0 ? (
              <EmptyState
                title="No curves fitted yet"
                description="Fit a curve above to model how discount depth drives net contribution."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Scope</TH>
                    <TH className="text-right">Optimal depth</TH>
                    <TH className="text-right">Optimal contrib</TH>
                  </TR>
                </THead>
                <TBody>
                  {curves.map((c) => {
                    const k = keyOf(c)
                    return (
                      <TR
                        key={k}
                        className={`cursor-pointer ${k === selectedKey ? 'bg-fuchsia-950/20' : ''}`}
                        onClick={() => {
                          setSelectedKey(k)
                          setPointResult(null)
                        }}
                      >
                        <TD>
                          <div className="flex items-center gap-2">
                            <Badge tone="fuchsia">{c.scope}</Badge>
                            <span className="text-slate-300">{c.scope_id}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">coef {c.coefficient?.toFixed(3) ?? '—'}</div>
                        </TD>
                        <TD className="text-right tabular-nums">{fmtPct(c.optimal_depth_pct)}</TD>
                        <TD className="text-right tabular-nums">{fmtMoney(c.optimal_contribution_cents)}</TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Curve detail + projector */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Curve</h2>
            <p className="text-xs text-slate-400">
              {selected ? `${selected.scope} · ${selected.scope_id}` : 'Select a curve'}
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            {!selected ? (
              <EmptyState title="No curve selected" description="Pick a fitted curve to view its shape and optimal depth." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Optimal depth" value={fmtPct(selected.optimal_depth_pct)} />
                  <Stat label="Peak contribution" value={fmtMoney(selected.optimal_contribution_cents)} tone="positive" />
                  <Stat label="Coefficient" value={selected.coefficient?.toFixed(3) ?? '—'} />
                </div>

                <CurveChart curve={selected} pointResult={pointResult} />

                {/* Point projector */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Point projector</div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="block text-sm">
                      <span className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                        <span>Discount depth</span>
                        <span className="text-fuchsia-300">{pointDepth}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={1}
                        value={pointDepth}
                        onChange={(e) => setPointDepth(Number(e.target.value))}
                        className="w-full accent-fuchsia-500"
                      />
                    </label>
                    <Button onClick={project} disabled={projecting}>
                      {projecting ? <Spinner className="mr-2" /> : null}
                      Project
                    </Button>
                  </div>
                  {pointResult && (
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-fuchsia-800 bg-fuchsia-950/30 px-4 py-3">
                      <span className="text-sm text-slate-300">
                        At {fmtPct(pointResult.depth_pct)} depth
                      </span>
                      <span className="text-lg font-bold text-fuchsia-300">
                        {fmtMoney(pointResult.contribution_cents)}
                      </span>
                    </div>
                  )}
                </div>

                {selected.computed_at && (
                  <p className="text-xs text-slate-500">Fitted {new Date(selected.computed_at).toLocaleString()}.</p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function CurveChart({ curve, pointResult }: { curve: ElasticityCurve; pointResult: CurvePoint | null }) {
  const points = (curve.curve_points ?? []).slice().sort((a, b) => asPct(a.depth_pct) - asPct(b.depth_pct))
  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
        No curve points returned for this fit.
      </div>
    )
  }

  const W = 600
  const H = 220
  const PAD = 36
  const xs = points.map((p) => asPct(p.depth_pct))
  const ys = points.map((p) => p.contribution_cents)
  const minX = Math.min(...xs, 0)
  const maxX = Math.max(...xs, 1)
  const minY = Math.min(...ys, 0)
  const maxY = Math.max(...ys, 1)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  const px = (x: number) => PAD + ((x - minX) / spanX) * (W - PAD * 2)
  const py = (y: number) => H - PAD - ((y - minY) / spanY) * (H - PAD * 2)

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(asPct(p.depth_pct)).toFixed(1)} ${py(p.contribution_cents).toFixed(1)}`).join(' ')

  const optDepth = asPct(curve.optimal_depth_pct)
  const optX = px(optDepth)
  const optY = py(curve.optimal_contribution_cents)

  const zeroY = py(0)

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Elasticity curve">
        {/* zero line */}
        {minY < 0 && maxY > 0 && (
          <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#475569" strokeDasharray="3 3" strokeWidth={1} />
        )}
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
        {/* curve */}
        <path d={path} fill="none" stroke="#d946ef" strokeWidth={2.5} />
        {/* points */}
        {points.map((p, i) => (
          <circle key={i} cx={px(asPct(p.depth_pct))} cy={py(p.contribution_cents)} r={2.5} fill="#f0abfc" />
        ))}
        {/* optimal marker */}
        <line x1={optX} y1={PAD} x2={optX} y2={H - PAD} stroke="#34d399" strokeDasharray="4 3" strokeWidth={1.5} />
        <circle cx={optX} cy={optY} r={5} fill="#34d399" />
        <text x={Math.min(optX + 6, W - PAD - 60)} y={PAD + 12} fill="#34d399" fontSize={11}>
          optimal {optDepth.toFixed(0)}%
        </text>
        {/* projected point */}
        {pointResult && (
          <>
            <circle cx={px(asPct(pointResult.depth_pct))} cy={py(pointResult.contribution_cents)} r={5} fill="#38bdf8" stroke="#0ea5e9" />
          </>
        )}
        {/* axis labels */}
        <text x={PAD} y={H - 8} fill="#64748b" fontSize={10}>{minX.toFixed(0)}%</text>
        <text x={W - PAD} y={H - 8} fill="#64748b" fontSize={10} textAnchor="end">{maxX.toFixed(0)}%</text>
        <text x={PAD + 4} y={PAD - 4} fill="#64748b" fontSize={10}>contribution</text>
      </svg>
    </div>
  )
}
