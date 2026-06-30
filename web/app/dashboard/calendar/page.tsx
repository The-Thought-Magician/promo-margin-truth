'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface CalendarEntry {
  id: string
  promo_id?: string | null
  name: string
  start_at: string
  end_at: string
  status: string
  projected_contribution_cents: number
  created_at?: string
}

interface Promo {
  id: string
  name: string
  status: string
  start_at?: string
  end_at?: string
}

interface Overlap {
  a: string
  b: string
  days: number
}

const money = (cents?: number | null) => {
  if (cents == null || Number.isNaN(cents)) return '—'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
const fmtMonthDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const toInput = (s?: string) => (s ? s.slice(0, 10) : '')
const dayMs = 86400000

const statusTone = (s: string): 'neutral' | 'green' | 'sky' | 'amber' | 'fuchsia' => {
  switch (s) {
    case 'active': return 'green'
    case 'planned': return 'sky'
    case 'ended': return 'amber'
    case 'analyzed': return 'fuchsia'
    default: return 'neutral'
  }
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-fuchsia-500 focus:outline-none'

interface FormState {
  promo_id: string
  name: string
  start_at: string
  end_at: string
  status: string
  projected_contribution: string // dollars input
}

const emptyForm: FormState = { promo_id: '', name: '', start_at: '', end_at: '', status: 'planned', projected_contribution: '' }

export default function CalendarPage() {
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [overlaps, setOverlaps] = useState<Overlap[]>([])
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [c, o, p] = await Promise.all([
        api.getCalendar(),
        api.getCalendarOverlaps().catch(() => ({ overlaps: [] })),
        api.getPromos().catch(() => []),
      ])
      setEntries(Array.isArray(c) ? c : [])
      setOverlaps(Array.isArray(o?.overlaps) ? o.overlaps : [])
      setPromos(Array.isArray(p) ? p : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const promoName = useCallback((id?: string | null) => promos.find((p) => p.id === id)?.name ?? null, [promos])

  // entry id/name lookup for overlaps (overlaps reference ids or names — display whichever resolves)
  const entryLabel = useCallback(
    (key: string) => {
      const byId = entries.find((e) => e.id === key)
      if (byId) return byId.name
      return key
    },
    [entries],
  )

  const totalProjected = useMemo(
    () => entries.reduce((sum, e) => sum + (e.projected_contribution_cents || 0), 0),
    [entries],
  )

  // ---- timeline bounds ----
  const timeline = useMemo(() => {
    if (entries.length === 0) return null
    const starts = entries.map((e) => new Date(e.start_at).getTime())
    const ends = entries.map((e) => new Date(e.end_at).getTime())
    const min = Math.min(...starts)
    const max = Math.max(...ends)
    const span = Math.max(max - min, dayMs)
    return { min, max, span }
  }, [entries])

  const sorted = useMemo(
    () => [...entries].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [entries],
  )

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm)
    setFormErr(null)
    setModalOpen(true)
  }

  const openEdit = (e: CalendarEntry) => {
    setEditId(e.id)
    setForm({
      promo_id: e.promo_id ?? '',
      name: e.name,
      start_at: toInput(e.start_at),
      end_at: toInput(e.end_at),
      status: e.status,
      projected_contribution: e.projected_contribution_cents ? String(e.projected_contribution_cents / 100) : '',
    })
    setFormErr(null)
    setModalOpen(true)
  }

  // when picking a promo in create form, prefill name/dates
  const onPickPromo = (pid: string) => {
    const p = promos.find((x) => x.id === pid)
    setForm((f) => ({
      ...f,
      promo_id: pid,
      name: f.name || (p?.name ?? ''),
      start_at: f.start_at || toInput(p?.start_at),
      end_at: f.end_at || toInput(p?.end_at),
    }))
  }

  const save = async () => {
    setFormErr(null)
    if (!form.name.trim()) { setFormErr('Name is required'); return }
    if (!form.start_at || !form.end_at) { setFormErr('Start and end dates are required'); return }
    if (new Date(form.end_at) < new Date(form.start_at)) { setFormErr('End must be on or after start'); return }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        promo_id: form.promo_id || null,
        name: form.name.trim(),
        start_at: new Date(form.start_at).toISOString(),
        end_at: new Date(form.end_at).toISOString(),
        status: form.status,
        projected_contribution_cents: form.projected_contribution
          ? Math.round(Number(form.projected_contribution) * 100)
          : 0,
      }
      if (editId) await api.updateCalendarEntry(editId, payload)
      else await api.createCalendarEntry(payload)
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    setDeleting(id)
    try {
      await api.deleteCalendarEntry(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <FullPageSpinner label="Loading calendar..." />

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Promo Calendar</h1>
          <p className="mt-1 text-sm text-slate-400">Plan windows, spot overlaps, and project contribution before you commit margin.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>Refresh</Button>
          <Button onClick={openCreate}>New entry</Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          <span>{error}</span>
          <Button variant="ghost" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entries" value={entries.length} />
        <Stat label="Overlaps" value={overlaps.length} tone={overlaps.length ? 'negative' : 'positive'} />
        <Stat label="Projected contribution" value={money(totalProjected)} tone={totalProjected >= 0 ? 'positive' : 'negative'} />
        <Stat label="Linked promos" value={entries.filter((e) => e.promo_id).length} />
      </div>

      {/* Overlap warnings */}
      {overlaps.length > 0 && (
        <Card className="border-amber-800/60">
          <CardHeader>
            <h2 className="text-base font-semibold text-amber-300">⚠ Overlap warnings</h2>
            <p className="text-xs text-slate-500">Concurrent promos compete for the same demand and contaminate incrementality reads.</p>
          </CardHeader>
          <CardBody className="space-y-2">
            {overlaps.map((o, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm">
                <span className="text-slate-200">
                  <span className="font-medium text-amber-200">{entryLabel(o.a)}</span>
                  {' '}overlaps{' '}
                  <span className="font-medium text-amber-200">{entryLabel(o.b)}</span>
                </span>
                <Badge tone="amber">{o.days} day{o.days === 1 ? '' : 's'}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* Timeline */}
      {timeline && sorted.length > 0 && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Timeline</h2>
            <span className="text-xs text-slate-500">{fmtMonthDay(new Date(timeline.min))} → {fmtMonthDay(new Date(timeline.max))}</span>
          </CardHeader>
          <CardBody className="space-y-2">
            {sorted.map((e) => {
              const start = new Date(e.start_at).getTime()
              const end = new Date(e.end_at).getTime()
              const left = ((start - timeline.min) / timeline.span) * 100
              const width = Math.max(((end - start) / timeline.span) * 100, 1.5)
              return (
                <div key={e.id} className="grid grid-cols-[150px_1fr] items-center gap-3">
                  <button
                    onClick={() => openEdit(e)}
                    className="truncate text-left text-xs text-slate-300 hover:text-fuchsia-400"
                    title={e.name}
                  >
                    {e.name}
                  </button>
                  <div className="relative h-6 rounded bg-slate-950/60">
                    <div
                      className={`absolute top-0 flex h-6 items-center justify-end rounded px-2 ${
                        e.projected_contribution_cents < 0 ? 'bg-rose-700/80' : 'bg-fuchsia-700/80'
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${fmtDate(e.start_at)} – ${fmtDate(e.end_at)} · ${money(e.projected_contribution_cents)}`}
                    >
                      <span className="truncate text-[10px] font-medium text-white">{money(e.projected_contribution_cents)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* Entries table */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Entries</h2>
        </CardHeader>
        <CardBody className="p-0">
          {entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No calendar entries yet"
                description="Add a window to start planning your promo calendar."
                action={<Button onClick={openCreate}>New entry</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Window</TH>
                  <TH>Status</TH>
                  <TH>Linked promo</TH>
                  <TH className="text-right">Projected</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sorted.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-medium text-white">{e.name}</TD>
                    <TD className="text-slate-400">{fmtDate(e.start_at)} – {fmtDate(e.end_at)}</TD>
                    <TD><Badge tone={statusTone(e.status)}>{e.status}</Badge></TD>
                    <TD className="text-slate-400">{promoName(e.promo_id) ?? <span className="text-slate-600">—</span>}</TD>
                    <TD className={`text-right tabular-nums ${e.projected_contribution_cents < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {money(e.projected_contribution_cents)}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openEdit(e)}>Edit</Button>
                        <Button variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => remove(e.id)} disabled={deleting === e.id}>
                          {deleting === e.id ? <Spinner /> : 'Delete'}
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

      {/* Create/edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'Edit calendar entry' : 'New calendar entry'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              {editId ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        {formErr && <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{formErr}</div>}
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Link to promo (optional)</span>
            <select className={inputCls} value={form.promo_id} onChange={(e) => onPickPromo(e.target.value)}>
              <option value="">— none —</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Spring Flash Sale" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Start</span>
              <input type="date" className={inputCls} value={form.start_at} onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">End</span>
              <input type="date" className={inputCls} value={form.end_at} onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
              <select className={inputCls} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="planned">planned</option>
                <option value="active">active</option>
                <option value="ended">ended</option>
                <option value="analyzed">analyzed</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Projected contribution ($)</span>
              <input type="number" step="0.01" className={inputCls} value={form.projected_contribution} onChange={(e) => setForm((f) => ({ ...f, projected_contribution: e.target.value }))} placeholder="0.00" />
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
