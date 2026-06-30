'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

// ---- Types (loose; backend shapes per build-plan) ----
interface Promo {
  id: string
  name: string
  promo_type: string
  discount_depth_pct: number
  start_at: string
  end_at: string
  status: string
  campaign_tag?: string | null
  owner?: string | null
  notes?: string | null
  channel_scope?: unknown
  eligible_skus?: unknown
}

interface WaterfallStep { label: string; amount_cents: number }

interface Pnl {
  promo_id: string
  gross_revenue_cents: number
  discount_cents: number
  net_revenue_cents: number
  cogs_cents: number
  platform_fee_cents: number
  contribution_cents: number
  realized_margin_pct: number
  list_margin_pct: number
  units: number
  avg_order_value_cents: number
  waterfall?: WaterfallStep[] | null
  computed_at?: string
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

interface Cannibalization {
  promo_id: string
  pull_forward_units: number
  pull_forward_revenue_cents: number
  cross_sku_revenue_cents: number
  already_converting_pct: number
  dollar_adjustment_cents: number
  detail?: unknown
  computed_at?: string
}

interface Split {
  promo_id: string
  new_count: number
  existing_count: number
  new_contribution_cents: number
  existing_contribution_cents: number
  existing_subsidy_cents: number
  computed_at?: string
}

// ---- Helpers ----
const money = (cents?: number | null) => {
  if (cents == null || Number.isNaN(cents)) return '—'
  const v = cents / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const moneySigned = (cents?: number | null) => {
  if (cents == null || Number.isNaN(cents)) return '—'
  const s = cents < 0 ? '-' : ''
  return s + money(Math.abs(cents))
}
const pct = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : `${(n).toFixed(1)}%`)
const num = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-US'))
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const statusTone = (status: string): 'neutral' | 'fuchsia' | 'green' | 'amber' | 'sky' => {
  switch (status) {
    case 'active': return 'green'
    case 'analyzed': return 'fuchsia'
    case 'planned': return 'sky'
    case 'ended': return 'amber'
    default: return 'neutral'
  }
}

export default function PromoDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [promo, setPromo] = useState<Promo | null>(null)
  const [pnl, setPnl] = useState<Pnl | null>(null)
  const [incr, setIncr] = useState<Incrementality[]>([])
  const [cannib, setCannib] = useState<Cannibalization | null>(null)
  const [split, setSplit] = useState<Split | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // per-section compute busy flags
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [incrMethod, setIncrMethod] = useState('pre_period')

  // edit modal
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Promo>>({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const setFlag = (k: string, v: boolean) => setBusy((b) => ({ ...b, [k]: v }))

  const loadAll = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [p, pl, ic, ca, sp] = await Promise.all([
        api.getPromo(id),
        api.getPnl(id).catch(() => null),
        api.getIncrementality(id).catch(() => []),
        api.getCannibalization(id).catch(() => null),
        api.getSplit(id).catch(() => null),
      ])
      setPromo(p)
      setPnl(pl)
      setIncr(Array.isArray(ic) ? ic : [])
      setCannib(ca)
      setSplit(sp)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load promo')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // ---- compute actions ----
  const runComputePnl = async () => {
    if (!id) return
    setFlag('pnl', true)
    try { setPnl(await api.computePnl(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'P&L compute failed') }
    finally { setFlag('pnl', false) }
  }

  const runComputeIncr = async () => {
    if (!id) return
    setFlag('incr', true)
    try {
      await api.computeIncrementality(id, incrMethod)
      const fresh = await api.getIncrementality(id)
      setIncr(Array.isArray(fresh) ? fresh : [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Incrementality compute failed') }
    finally { setFlag('incr', false) }
  }

  const runComputeCannib = async () => {
    if (!id) return
    setFlag('cannib', true)
    try { setCannib(await api.computeCannibalization(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Cannibalization compute failed') }
    finally { setFlag('cannib', false) }
  }

  const runComputeSplit = async () => {
    if (!id) return
    setFlag('split', true)
    try { setSplit(await api.computeSplit(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Split compute failed') }
    finally { setFlag('split', false) }
  }

  const runComputeAll = async () => {
    await Promise.all([runComputePnl(), runComputeIncr(), runComputeCannib(), runComputeSplit()])
  }

  // ---- edit ----
  const openEdit = () => {
    if (!promo) return
    setSaveErr(null)
    setEditForm({
      name: promo.name,
      promo_type: promo.promo_type,
      discount_depth_pct: promo.discount_depth_pct,
      start_at: promo.start_at?.slice(0, 10),
      end_at: promo.end_at?.slice(0, 10),
      campaign_tag: promo.campaign_tag ?? '',
      owner: promo.owner ?? '',
      notes: promo.notes ?? '',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!id) return
    setSaving(true)
    setSaveErr(null)
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name,
        promo_type: editForm.promo_type,
        discount_depth_pct: Number(editForm.discount_depth_pct),
        campaign_tag: editForm.campaign_tag || null,
        owner: editForm.owner || null,
        notes: editForm.notes || null,
      }
      if (editForm.start_at) payload.start_at = new Date(editForm.start_at as string).toISOString()
      if (editForm.end_at) payload.end_at = new Date(editForm.end_at as string).toISOString()
      const updated = await api.updatePromo(id, payload)
      setPromo(updated)
      setEditOpen(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading promo..." />

  if (error && !promo) {
    return (
      <div className="mx-auto max-w-5xl py-8">
        <EmptyState
          title="Could not load this promo"
          description={error}
          action={<Button onClick={loadAll}>Retry</Button>}
        />
      </div>
    )
  }

  if (!promo) {
    return (
      <div className="mx-auto max-w-5xl py-8">
        <EmptyState
          title="Promo not found"
          description="This promotion may have been deleted."
          action={<Button onClick={() => router.push('/dashboard/promos')}>Back to catalog</Button>}
        />
      </div>
    )
  }

  const contribTone = pnl ? (pnl.contribution_cents >= 0 ? 'positive' : 'negative') : 'default'

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            onClick={() => router.push('/dashboard/promos')}
            className="mb-2 text-xs text-slate-500 hover:text-fuchsia-400"
          >
            ← Back to catalog
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{promo.name}</h1>
            <Badge tone={statusTone(promo.status)}>{promo.status}</Badge>
            <Badge tone="neutral">{promo.promo_type}</Badge>
            <Badge tone="fuchsia">{pct(promo.discount_depth_pct)} off</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {fmtDate(promo.start_at)} – {fmtDate(promo.end_at)}
            {promo.campaign_tag ? <> · tag <span className="text-slate-300">{promo.campaign_tag}</span></> : null}
            {promo.owner ? <> · owner <span className="text-slate-300">{promo.owner}</span></> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openEdit}>Edit</Button>
          <Button onClick={runComputeAll} disabled={Object.values(busy).some(Boolean)}>
            {Object.values(busy).some(Boolean) ? <Spinner className="mr-2" /> : null}
            Recompute all
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {promo.notes && (
        <Card>
          <CardBody className="text-sm text-slate-300">{promo.notes}</CardBody>
        </Card>
      )}

      {/* ============ P&L ============ */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">P&amp;L Waterfall</h2>
            <p className="text-xs text-slate-500">Gross revenue down to true contribution margin.</p>
          </div>
          <Button variant="secondary" onClick={runComputePnl} disabled={busy.pnl}>
            {busy.pnl ? <Spinner className="mr-2" /> : null}
            {pnl ? 'Recompute' : 'Compute P&L'}
          </Button>
        </CardHeader>
        <CardBody>
          {!pnl ? (
            <EmptyState
              title="No P&L computed yet"
              description="Run the P&L computation to build the contribution-margin waterfall from order lines, COGS, and platform fees."
              action={<Button onClick={runComputePnl} disabled={busy.pnl}>Compute P&L</Button>}
            />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Gross revenue" value={money(pnl.gross_revenue_cents)} />
                <Stat label="Net revenue" value={money(pnl.net_revenue_cents)} hint={`${money(pnl.discount_cents)} discount`} />
                <Stat label="Contribution" value={moneySigned(pnl.contribution_cents)} tone={contribTone} />
                <Stat label="Realized margin" value={pct(pnl.realized_margin_pct)} hint={`list ${pct(pnl.list_margin_pct)}`} />
                <Stat label="Units" value={num(pnl.units)} hint={`AOV ${money(pnl.avg_order_value_cents)}`} />
              </div>
              <Waterfall pnl={pnl} />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ============ Incrementality ============ */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Incrementality</h2>
              <p className="text-xs text-slate-500">Baseline vs observed units with confidence band.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={incrMethod}
                onChange={(e) => setIncrMethod(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="pre_period">Pre-period</option>
                <option value="control">Control group</option>
                <option value="blended">Blended</option>
              </select>
              <Button variant="secondary" onClick={runComputeIncr} disabled={busy.incr}>
                {busy.incr ? <Spinner className="mr-2" /> : null}
                Compute
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {incr.length === 0 ? (
              <EmptyState
                title="No incrementality yet"
                description="Pick a baseline method and compute to estimate truly incremental units and revenue."
              />
            ) : (
              <div className="space-y-4">
                {incr.map((r) => (
                  <IncrementalityBlock key={r.id ?? r.method} r={r} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* ============ Customer split ============ */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">New vs Existing</h2>
              <p className="text-xs text-slate-500">How much margin existing customers absorbed.</p>
            </div>
            <Button variant="secondary" onClick={runComputeSplit} disabled={busy.split}>
              {busy.split ? <Spinner className="mr-2" /> : null}
              {split ? 'Recompute' : 'Compute'}
            </Button>
          </CardHeader>
          <CardBody>
            {!split ? (
              <EmptyState title="No customer split yet" description="Compute to break contribution into new vs existing buyers." />
            ) : (
              <SplitBlock split={split} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ============ Cannibalization ============ */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Cannibalization</h2>
            <p className="text-xs text-slate-500">Pull-forward, cross-SKU bleed, and the dollar adjustment to true contribution.</p>
          </div>
          <Button variant="secondary" onClick={runComputeCannib} disabled={busy.cannib}>
            {busy.cannib ? <Spinner className="mr-2" /> : null}
            {cannib ? 'Recompute' : 'Compute'}
          </Button>
        </CardHeader>
        <CardBody>
          {!cannib ? (
            <EmptyState
              title="No cannibalization computed"
              description="Estimate pull-forward demand, cross-SKU substitution, and already-converting customers."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Pull-forward units" value={num(cannib.pull_forward_units)} />
              <Stat label="Pull-forward rev" value={money(cannib.pull_forward_revenue_cents)} />
              <Stat label="Cross-SKU rev" value={money(cannib.cross_sku_revenue_cents)} />
              <Stat label="Already converting" value={pct(cannib.already_converting_pct)} />
              <Stat
                label="Dollar adjustment"
                value={moneySigned(cannib.dollar_adjustment_cents)}
                tone={cannib.dollar_adjustment_cents < 0 ? 'negative' : 'positive'}
                className="col-span-2 md:col-span-4"
                hint="Applied to reported contribution to reveal true incremental value."
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit promo"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              Save
            </Button>
          </>
        }
      >
        {saveErr && <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{saveErr}</div>}
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputCls} value={editForm.name ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <input className={inputCls} value={editForm.promo_type ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, promo_type: e.target.value }))} />
            </Field>
            <Field label="Discount depth %">
              <input type="number" step="0.1" className={inputCls} value={editForm.discount_depth_pct ?? 0} onChange={(e) => setEditForm((f) => ({ ...f, discount_depth_pct: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input type="date" className={inputCls} value={(editForm.start_at as string) ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, start_at: e.target.value }))} />
            </Field>
            <Field label="End">
              <input type="date" className={inputCls} value={(editForm.end_at as string) ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, end_at: e.target.value }))} />
            </Field>
          </div>
          <Field label="Campaign tag">
            <input className={inputCls} value={(editForm.campaign_tag as string) ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, campaign_tag: e.target.value }))} />
          </Field>
          <Field label="Owner">
            <input className={inputCls} value={(editForm.owner as string) ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, owner: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={(editForm.notes as string) ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-fuchsia-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

// ---- P&L waterfall (SVG-free, div bars) ----
function Waterfall({ pnl }: { pnl: Pnl }) {
  const steps: WaterfallStep[] =
    pnl.waterfall && pnl.waterfall.length
      ? pnl.waterfall
      : [
          { label: 'Gross revenue', amount_cents: pnl.gross_revenue_cents },
          { label: 'Discount', amount_cents: -Math.abs(pnl.discount_cents) },
          { label: 'COGS', amount_cents: -Math.abs(pnl.cogs_cents) },
          { label: 'Platform fee', amount_cents: -Math.abs(pnl.platform_fee_cents) },
          { label: 'Contribution', amount_cents: pnl.contribution_cents },
        ]

  // Build running cumulative for floating bars; treat last step as a total reset.
  const max = Math.max(pnl.gross_revenue_cents, 1)
  let running = 0
  const rows = steps.map((s, i) => {
    const isTotal = i === 0 || i === steps.length - 1
    let start: number
    let end: number
    if (isTotal) {
      start = 0
      end = s.amount_cents
      running = s.amount_cents
    } else {
      start = running
      end = running + s.amount_cents
      running = end
    }
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    return {
      label: s.label,
      amount: s.amount_cents,
      leftPct: (Math.max(lo, 0) / max) * 100,
      widthPct: (Math.max(hi - Math.max(lo, 0), 0) / max) * 100,
      negative: s.amount_cents < 0,
      isTotal,
    }
  })

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[140px_1fr_110px] items-center gap-3">
          <div className="truncate text-xs text-slate-400">{r.label}</div>
          <div className="relative h-6 rounded bg-slate-950/60">
            <div
              className={`absolute top-0 h-6 rounded ${
                r.isTotal ? 'bg-fuchsia-600' : r.negative ? 'bg-rose-700/80' : 'bg-emerald-700/80'
              }`}
              style={{ left: `${r.leftPct}%`, width: `${Math.max(r.widthPct, 0.5)}%` }}
            />
          </div>
          <div className={`text-right text-xs font-medium tabular-nums ${r.negative ? 'text-rose-300' : r.isTotal ? 'text-fuchsia-300' : 'text-emerald-300'}`}>
            {moneySigned(r.amount)}
          </div>
        </div>
      ))}
    </div>
  )
}

function IncrementalityBlock({ r }: { r: Incrementality }) {
  // band range for the bar scale
  const scaleMax = Math.max(r.observed_units, r.baseline_units, r.confidence_high, 1)
  const w = (v: number) => `${Math.max((Math.max(v, 0) / scaleMax) * 100, 0)}%`
  const ratioPct = r.incrementality_ratio != null ? r.incrementality_ratio * 100 : null
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <Badge tone="fuchsia">{r.method}</Badge>
        <span className="text-xs text-slate-500">
          incremental ratio {ratioPct == null ? '—' : `${ratioPct.toFixed(0)}%`}
        </span>
      </div>
      <div className="space-y-2">
        <Bar label="Baseline" value={r.baseline_units} width={w(r.baseline_units)} tone="bg-slate-600" right={num(r.baseline_units)} />
        <Bar label="Observed" value={r.observed_units} width={w(r.observed_units)} tone="bg-fuchsia-600" right={num(r.observed_units)} />
        {/* confidence band */}
        <div className="grid grid-cols-[80px_1fr_70px] items-center gap-3">
          <div className="text-xs text-slate-400">CI band</div>
          <div className="relative h-3 rounded bg-slate-950">
            <div
              className="absolute top-0 h-3 rounded bg-sky-700/50"
              style={{ left: w(r.confidence_low), width: `${Math.max((Math.max(r.confidence_high - r.confidence_low, 0) / scaleMax) * 100, 1)}%` }}
            />
          </div>
          <div className="text-right text-xs text-slate-500 tabular-nums">{num(r.confidence_low)}–{num(r.confidence_high)}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-900/60 px-3 py-2">
          <div className="text-slate-500">Incremental units</div>
          <div className="font-semibold text-emerald-300">{num(r.incremental_units)}</div>
        </div>
        <div className="rounded bg-slate-900/60 px-3 py-2">
          <div className="text-slate-500">Incremental revenue</div>
          <div className="font-semibold text-emerald-300">{money(r.incremental_revenue_cents)}</div>
        </div>
      </div>
    </div>
  )
}

function Bar({ label, width, tone, right }: { label: string; value: number; width: string; tone: string; right: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr_70px] items-center gap-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="relative h-4 rounded bg-slate-950">
        <div className={`absolute top-0 h-4 rounded ${tone}`} style={{ width }} />
      </div>
      <div className="text-right text-xs text-slate-300 tabular-nums">{right}</div>
    </div>
  )
}

function SplitBlock({ split }: { split: Split }) {
  const total = (split.new_count || 0) + (split.existing_count || 0)
  const newPct = total > 0 ? (split.new_count / total) * 100 : 0
  return (
    <div className="space-y-4">
      <div className="h-4 overflow-hidden rounded-full bg-slate-950">
        <div className="flex h-4">
          <div className="bg-fuchsia-600" style={{ width: `${newPct}%` }} title="New" />
          <div className="flex-1 bg-slate-600" title="Existing" />
        </div>
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span><span className="inline-block h-2 w-2 rounded-full bg-fuchsia-600 align-middle" /> New {num(split.new_count)} ({newPct.toFixed(0)}%)</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-slate-600 align-middle" /> Existing {num(split.existing_count)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="New contribution" value={moneySigned(split.new_contribution_cents)} tone={split.new_contribution_cents >= 0 ? 'positive' : 'negative'} />
        <Stat label="Existing contribution" value={moneySigned(split.existing_contribution_cents)} tone={split.existing_contribution_cents >= 0 ? 'positive' : 'negative'} />
      </div>
      <Stat
        label="Existing-customer subsidy"
        value={moneySigned(split.existing_subsidy_cents)}
        tone="negative"
        hint="Margin handed to buyers who would likely have purchased anyway."
      />
    </div>
  )
}
