'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Promo {
  id: string
  name: string
  discount_depth_pct?: number
  status?: string
}

interface ScenarioParams {
  depth_pct?: number
  duration_days?: number
  channel?: string
  [k: string]: unknown
}

interface Scenario {
  id: string
  name: string
  base_promo_id: string | null
  params: ScenarioParams | null
  projected_contribution_cents: number
  created_at?: string
  updated_at?: string
}

const fmtMoney = (cents: number | null | undefined) => {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface FormState {
  name: string
  base_promo_id: string
  depth_pct: number
  duration_days: number
  channel: string
}

const emptyForm: FormState = {
  name: '',
  base_promo_id: '',
  depth_pct: 20,
  duration_days: 14,
  channel: 'all',
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [sc, pr] = await Promise.all([api.getScenarios(), api.getPromos()])
      setScenarios(sc)
      setPromos(pr)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm({ ...emptyForm, base_promo_id: promos[0]?.id ?? '' })
    setActionError(null)
    setModalOpen(true)
  }

  function openEdit(s: Scenario) {
    setEditingId(s.id)
    setForm({
      name: s.name,
      base_promo_id: s.base_promo_id ?? '',
      depth_pct: Number(s.params?.depth_pct ?? 20),
      duration_days: Number(s.params?.duration_days ?? 14),
      channel: String(s.params?.channel ?? 'all'),
    })
    setActionError(null)
    setModalOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setActionError('Scenario name is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    const payload = {
      name: form.name.trim(),
      base_promo_id: form.base_promo_id || null,
      params: {
        depth_pct: form.depth_pct,
        duration_days: form.duration_days,
        channel: form.channel,
      },
    }
    try {
      if (editingId) {
        await api.updateScenario(editingId, payload)
      } else {
        await api.createScenario(payload)
      }
      setModalOpen(false)
      await loadAll()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    setActionError(null)
    try {
      await api.deleteScenario(id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      await loadAll()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds)
    setActionError(null)
    for (const id of ids) {
      try {
        await api.deleteScenario(id)
      } catch (e) {
        setActionError(e instanceof Error ? e.message : `Delete failed for ${id}`)
      }
    }
    setSelectedIds(new Set())
    await loadAll()
  }

  const promoName = (id: string | null) => (id ? promos.find((p) => p.id === id)?.name ?? 'Unknown promo' : 'No base promo')

  const maxContribution = useMemo(
    () => Math.max(1, ...scenarios.map((s) => Math.abs(s.projected_contribution_cents ?? 0))),
    [scenarios]
  )

  const best = useMemo(() => {
    if (scenarios.length === 0) return null
    return scenarios.reduce((a, b) =>
      (b.projected_contribution_cents ?? 0) > (a.projected_contribution_cents ?? 0) ? b : a
    )
  }, [scenarios])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <FullPageSpinner label="Loading scenarios..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scenario builder</h1>
          <p className="mt-1 text-sm text-slate-400">
            Model what-if promos against a base, then compare projected net contribution side by side.
          </p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button variant="danger" onClick={removeSelected}>
              Delete {selectedIds.size} selected
            </Button>
          )}
          <Button onClick={openCreate}>New scenario</Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardBody>
            <EmptyState
              title="Could not load scenarios"
              description={error}
              action={
                <Button variant="secondary" onClick={loadAll}>
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

      {!error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Scenarios" value={scenarios.length} />
          <Stat
            label="Best projected contribution"
            value={best ? fmtMoney(best.projected_contribution_cents) : '—'}
            tone={best && best.projected_contribution_cents > 0 ? 'positive' : 'default'}
            hint={best ? best.name : undefined}
          />
          <Stat label="Base promos available" value={promos.length} />
        </div>
      )}

      {/* Comparison chart */}
      {scenarios.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Projected contribution comparison</h2>
            <p className="text-xs text-slate-400">Bars scaled to the largest absolute projection.</p>
          </CardHeader>
          <CardBody className="space-y-3">
            {scenarios.map((s) => {
              const v = s.projected_contribution_cents ?? 0
              const pct = (Math.abs(v) / maxContribution) * 100
              const positive = v >= 0
              return (
                <div key={s.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate text-slate-300">{s.name}</span>
                    <span className={`tabular-nums ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmtMoney(v)}
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full ${positive ? 'bg-fuchsia-500' : 'bg-rose-500'}`}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* Scenario table */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Scenarios</h2>
        </CardHeader>
        <CardBody>
          {scenarios.length === 0 ? (
            <EmptyState
              title="No scenarios yet"
              description="Build a what-if scenario from a base promo to project its net contribution."
              action={<Button onClick={openCreate}>New scenario</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-8" />
                  <TH>Scenario</TH>
                  <TH>Base promo</TH>
                  <TH className="text-right">Depth</TH>
                  <TH className="text-right">Duration</TH>
                  <TH>Channel</TH>
                  <TH className="text-right">Projected contrib</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {scenarios.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="h-4 w-4 accent-fuchsia-500"
                      />
                    </TD>
                    <TD className="font-medium text-white">{s.name}</TD>
                    <TD className="text-slate-300">{promoName(s.base_promo_id)}</TD>
                    <TD className="text-right tabular-nums">{s.params?.depth_pct != null ? `${s.params.depth_pct}%` : '—'}</TD>
                    <TD className="text-right tabular-nums">
                      {s.params?.duration_days != null ? `${s.params.duration_days}d` : '—'}
                    </TD>
                    <TD>
                      <Badge tone="sky">{String(s.params?.channel ?? 'all')}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className={s.projected_contribution_cents >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {fmtMoney(s.projected_contribution_cents)}
                      </span>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => openEdit(s)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="px-3 py-1 text-xs"
                          disabled={deletingId === s.id}
                          onClick={() => remove(s.id)}
                        >
                          {deletingId === s.id ? <Spinner className="mr-1" /> : null}
                          Delete
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
        title={editingId ? 'Edit scenario' : 'New scenario'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              {editingId ? 'Save changes' : 'Create & project'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {actionError}
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. BFCM 30% off, 7 days"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Base promo</span>
            <select
              value={form.base_promo_id}
              onChange={(e) => setForm((f) => ({ ...f, base_promo_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="">No base promo</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                <span>Discount depth</span>
                <span className="text-fuchsia-300">{form.depth_pct}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={90}
                step={1}
                value={form.depth_pct}
                onChange={(e) => setForm((f) => ({ ...f, depth_pct: Number(e.target.value) }))}
                className="w-full accent-fuchsia-500"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Duration (days)</span>
              <input
                type="number"
                min={1}
                value={form.duration_days}
                onChange={(e) => setForm((f) => ({ ...f, duration_days: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Channel</span>
            <select
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="all">All channels</option>
              <option value="dtc">DTC</option>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="marketplace">Marketplace</option>
            </select>
          </label>

          <p className="text-xs text-slate-500">
            Projected net contribution is computed server-side from the fitted elasticity curve when you save.
          </p>
        </div>
      </Modal>
    </div>
  )
}
