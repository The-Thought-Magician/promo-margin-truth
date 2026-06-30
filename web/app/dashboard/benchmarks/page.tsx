'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Benchmark {
  id: string
  scope: string
  scope_id: string | null
  label: string
  target_margin_pct: number
  target_contribution_cents: number
  created_at: string
}

interface VarianceRow {
  scope_id: string | null
  target: number
  actual: number
  variance: number
  label?: string
}

const fmtMoney = (cents: number) => {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const asPct = (v: number) => (Math.abs(v ?? 0) <= 1 ? (v ?? 0) * 100 : v ?? 0)
const fmtPct = (v: number) => `${asPct(v).toFixed(1)}%`

const SCOPES = ['promo', 'collection', 'channel', 'global'] as const

interface FormState {
  scope: string
  scope_id: string
  label: string
  target_margin_pct: string
  target_contribution_dollars: string
}

const emptyForm: FormState = {
  scope: 'promo',
  scope_id: '',
  label: '',
  target_margin_pct: '',
  target_contribution_dollars: '',
}

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [variance, setVariance] = useState<VarianceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Benchmark | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<string>('all')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [b, v] = await Promise.all([api.getBenchmarks(), api.getBenchmarkVariance()])
      setBenchmarks(b ?? [])
      setVariance((v?.rows ?? v ?? []) as VarianceRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load benchmarks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (b: Benchmark) => {
    setEditing(b)
    setForm({
      scope: b.scope,
      scope_id: b.scope_id ?? '',
      label: b.label,
      target_margin_pct: String(asPct(b.target_margin_pct)),
      target_contribution_dollars: String((b.target_contribution_cents ?? 0) / 100),
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async () => {
    if (!form.label.trim()) {
      setFormError('Label is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload = {
      scope: form.scope,
      scope_id: form.scope === 'global' ? null : form.scope_id.trim() || null,
      label: form.label.trim(),
      target_margin_pct: Number(form.target_margin_pct || 0) / 100,
      target_contribution_cents: Math.round(Number(form.target_contribution_dollars || 0) * 100),
    }
    try {
      if (editing) await api.updateBenchmark(editing.id, payload)
      else await api.createBenchmark(payload)
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save benchmark')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (b: Benchmark) => {
    if (!confirm(`Delete benchmark "${b.label}"?`)) return
    setDeletingId(b.id)
    try {
      await api.deleteBenchmark(b.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete benchmark')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = useMemo(
    () => (scopeFilter === 'all' ? benchmarks : benchmarks.filter((b) => b.scope === scopeFilter)),
    [benchmarks, scopeFilter],
  )

  const summary = useMemo(() => {
    const hit = variance.filter((r) => (r.variance ?? 0) >= 0).length
    const miss = variance.length - hit
    const worst = [...variance].sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))[0]
    return { hit, miss, worst }
  }, [variance])

  const maxAbs = useMemo(
    () => Math.max(1, ...variance.map((r) => Math.max(Math.abs(asPct(r.target)), Math.abs(asPct(r.actual))))),
    [variance],
  )

  if (loading) return <FullPageSpinner label="Loading benchmarks..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Benchmarks & Targets</h1>
          <p className="mt-1 text-sm text-slate-400">
            Set margin and contribution targets, then track realized variance against them.
          </p>
        </div>
        <Button onClick={openCreate}>+ New target</Button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Targets Set" value={benchmarks.length} />
        <Stat label="On / Above Target" value={summary.hit} tone="positive" />
        <Stat label="Below Target" value={summary.miss} tone={summary.miss > 0 ? 'negative' : 'default'} />
      </div>

      {/* Variance overlay */}
      <Card>
        <CardHeader>
          <div className="text-sm font-semibold text-white">Benchmark vs. Realized Variance</div>
          <div className="text-xs text-slate-500">Target margin vs actual margin, per scope</div>
        </CardHeader>
        <CardBody>
          {variance.length === 0 ? (
            <EmptyState
              title="No variance data yet"
              description="Once benchmarks have realized margins to compare against, variance appears here."
              icon="📊"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Scope</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">Actual</TH>
                  <TH>Overlay</TH>
                  <TH className="text-right">Variance</TH>
                  <TH className="text-right">Status</TH>
                </TR>
              </THead>
              <TBody>
                {variance.map((r, i) => {
                  const t = asPct(r.target)
                  const a = asPct(r.actual)
                  const v = asPct(r.variance)
                  const ok = (r.variance ?? 0) >= 0
                  return (
                    <TR key={(r.scope_id ?? 'row') + i}>
                      <TD className="font-medium text-slate-100">{r.label ?? r.scope_id ?? '—'}</TD>
                      <TD className="text-right tabular-nums text-slate-400">{t.toFixed(1)}%</TD>
                      <TD className={`text-right tabular-nums ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {a.toFixed(1)}%
                      </TD>
                      <TD className="w-56">
                        <div className="relative h-3 w-full rounded-full bg-slate-800">
                          {/* target marker */}
                          <div
                            className="absolute top-[-3px] h-[18px] w-0.5 bg-slate-400"
                            style={{ left: `${(Math.max(0, t) / maxAbs) * 100}%` }}
                            title={`Target ${t.toFixed(1)}%`}
                          />
                          {/* actual fill */}
                          <div
                            className={`h-full rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            style={{ width: `${(Math.max(0, a) / maxAbs) * 100}%` }}
                          />
                        </div>
                      </TD>
                      <TD className={`text-right tabular-nums ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {v >= 0 ? '+' : ''}
                        {v.toFixed(1)} pts
                      </TD>
                      <TD className="text-right">
                        <Badge tone={ok ? 'green' : 'red'}>{ok ? 'on target' : 'below'}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Benchmarks list */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">Defined Targets</div>
          <div className="flex flex-wrap gap-1.5">
            {['all', ...SCOPES].map((s) => (
              <button
                key={s}
                onClick={() => setScopeFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                  scopeFilter === s
                    ? 'border-fuchsia-700 bg-fuchsia-950/50 text-fuchsia-300'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title="No targets defined"
              description="Create a benchmark to set a margin or contribution goal for a promo, collection, channel, or the whole portfolio."
              icon="🎯"
              action={<Button onClick={openCreate}>+ New target</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Scope</TH>
                  <TH className="text-right">Target Margin</TH>
                  <TH className="text-right">Target Contribution</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-medium text-slate-100">{b.label}</TD>
                    <TD>
                      <Badge tone="fuchsia">{b.scope}</Badge>
                      {b.scope_id ? <span className="ml-2 text-xs text-slate-500">{b.scope_id}</span> : null}
                    </TD>
                    <TD className="text-right tabular-nums">{fmtPct(b.target_margin_pct)}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(b.target_contribution_cents)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => openEdit(b)} className="px-2 py-1">
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => remove(b)}
                          disabled={deletingId === b.id}
                          className="px-2 py-1 text-rose-400 hover:text-rose-300"
                        >
                          {deletingId === b.id ? <Spinner /> : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit target' : 'New target'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              {editing ? 'Save changes' : 'Create target'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Label</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Q4 sitewide margin floor"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Scope ID</label>
              <input
                value={form.scope_id}
                onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                placeholder={form.scope === 'global' ? 'n/a' : 'promo / collection / channel id'}
                disabled={form.scope === 'global'}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-fuchsia-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Target Margin (%)</label>
              <input
                type="number"
                step="0.1"
                value={form.target_margin_pct}
                onChange={(e) => setForm({ ...form, target_margin_pct: e.target.value })}
                placeholder="e.g. 35"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Target Contribution ($)</label>
              <input
                type="number"
                step="1"
                value={form.target_contribution_dollars}
                onChange={(e) => setForm({ ...form, target_contribution_dollars: e.target.value })}
                placeholder="e.g. 50000"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
