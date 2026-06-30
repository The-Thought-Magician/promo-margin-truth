'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
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
  promo_type: string | null
  discount_depth_pct: number | null
  start_at: string | null
  end_at: string | null
  status: string | null
  campaign_tag: string | null
  owner: string | null
  notes: string | null
}

type StatusTone = 'neutral' | 'fuchsia' | 'green' | 'red' | 'amber' | 'sky'

const STATUSES = ['planned', 'active', 'ended', 'analyzed'] as const
const PROMO_TYPES = ['percent_off', 'dollar_off', 'bogo', 'bundle', 'free_shipping', 'gift_with_purchase'] as const

const statusTone: Record<string, StatusTone> = {
  planned: 'sky',
  active: 'fuchsia',
  ended: 'neutral',
  analyzed: 'green',
}

const fmtDate = (ts: string | null | undefined) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

const toDateInput = (ts: string | null | undefined) => {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

const emptyForm = {
  name: '',
  promo_type: 'percent_off',
  discount_depth: '',
  start_at: '',
  end_at: '',
  status: 'planned',
  campaign_tag: '',
  owner: '',
  notes: '',
}

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [cloneTarget, setCloneTarget] = useState<Promo | null>(null)
  const [cloneForm, setCloneForm] = useState({ name: '', start_at: '', end_at: '' })
  const [cloneErr, setCloneErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await api.getPromos()
      setPromos(Array.isArray(p) ? p : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load promos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { planned: 0, active: 0, ended: 0, analyzed: 0 }
    for (const p of promos) if (p.status && c[p.status] !== undefined) c[p.status]++
    return c
  }, [promos])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return promos.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false
      if (!q) return true
      return (
        p.name?.toLowerCase().includes(q) ||
        (p.campaign_tag ?? '').toLowerCase().includes(q) ||
        (p.owner ?? '').toLowerCase().includes(q) ||
        (p.promo_type ?? '').toLowerCase().includes(q)
      )
    })
  }, [promos, search, statusFilter])

  const submitCreate = async () => {
    setFormErr(null)
    if (!form.name.trim()) {
      setFormErr('Name is required.')
      return
    }
    const depth = form.discount_depth ? parseFloat(form.discount_depth) : 0
    if (form.discount_depth && (isNaN(depth) || depth < 0 || depth > 100)) {
      setFormErr('Discount depth must be a percentage between 0 and 100.')
      return
    }
    if (form.start_at && form.end_at && new Date(form.end_at) < new Date(form.start_at)) {
      setFormErr('End date cannot be before start date.')
      return
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      promo_type: form.promo_type,
      discount_depth_pct: depth,
      status: form.status,
      campaign_tag: form.campaign_tag.trim() || null,
      owner: form.owner.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (form.start_at) payload.start_at = new Date(form.start_at).toISOString()
    if (form.end_at) payload.end_at = new Date(form.end_at).toISOString()
    setBusy(true)
    try {
      await api.createPromo(payload)
      setCreateOpen(false)
      setForm(emptyForm)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (p: Promo, status: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.setPromoStatus(p.id, status)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status change failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Promo) => {
    if (!confirm(`Delete promo "${p.name}"? Analyses tied to it may be removed.`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deletePromo(p.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const openClone = (p: Promo) => {
    setCloneTarget(p)
    setCloneForm({ name: `${p.name} (copy)`, start_at: '', end_at: '' })
    setCloneErr(null)
  }

  const submitClone = async () => {
    if (!cloneTarget) return
    setCloneErr(null)
    if (!cloneForm.name.trim()) {
      setCloneErr('New name is required.')
      return
    }
    if (cloneForm.start_at && cloneForm.end_at && new Date(cloneForm.end_at) < new Date(cloneForm.start_at)) {
      setCloneErr('End date cannot be before start date.')
      return
    }
    const payload: Record<string, unknown> = { name: cloneForm.name.trim() }
    if (cloneForm.start_at) payload.start_at = new Date(cloneForm.start_at).toISOString()
    if (cloneForm.end_at) payload.end_at = new Date(cloneForm.end_at).toISOString()
    setBusy(true)
    try {
      await api.clonePromo(cloneTarget.id, payload)
      setCloneTarget(null)
      await load()
    } catch (e) {
      setCloneErr(e instanceof Error ? e.message : 'Clone failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading promo catalog..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Promo Catalog</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every trade promotion you run. Define it here, attach orders by campaign tag, then drill into the truth on
            each promo&apos;s detail page.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New promo</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total" value={promos.length.toLocaleString()} />
        <Stat label="Planned" value={counts.planned} />
        <Stat label="Active" value={counts.active} tone={counts.active > 0 ? 'positive' : 'default'} />
        <Stat label="Ended" value={counts.ended} />
        <Stat label="Analyzed" value={counts.analyzed} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`rounded-full border px-3 py-1 text-xs ${
                statusFilter === '' ? 'border-fuchsia-600 bg-fuchsia-950/50 text-fuchsia-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs capitalize ${
                  statusFilter === s
                    ? 'border-fuchsia-600 bg-fuchsia-950/50 text-fuchsia-200'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / tag / owner"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody>
          {promos.length === 0 ? (
            <EmptyState
              title="No promos yet"
              description="Create your first promo, or seed the sample brand from the Ingestion page to get a portfolio including a deliberately money-losing promo."
              action={<Button onClick={() => setCreateOpen(true)}>+ New promo</Button>}
            />
          ) : visible.length === 0 ? (
            <EmptyState title="No matches" description="No promos match the current filters." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Depth</TH>
                  <TH>Window</TH>
                  <TH>Tag</TH>
                  <TH>Owner</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/dashboard/promos/${p.id}`} className="font-medium text-fuchsia-300 hover:text-fuchsia-200 hover:underline">
                        {p.name}
                      </Link>
                    </TD>
                    <TD className="text-slate-400">{(p.promo_type ?? '—').replace(/_/g, ' ')}</TD>
                    <TD className="text-right tabular-nums">
                      {p.discount_depth_pct != null ? `${p.discount_depth_pct}%` : '—'}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-slate-400">
                      {fmtDate(p.start_at)} → {fmtDate(p.end_at)}
                    </TD>
                    <TD>{p.campaign_tag ? <Badge tone="neutral">{p.campaign_tag}</Badge> : <span className="text-slate-600">—</span>}</TD>
                    <TD className="text-slate-400">{p.owner || '—'}</TD>
                    <TD>
                      <select
                        value={p.status ?? 'planned'}
                        disabled={busy}
                        onChange={(e) => changeStatus(p, e.target.value)}
                        className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-fuchsia-500 focus:outline-none disabled:opacity-50"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="ml-2 inline-block align-middle">
                        <Badge tone={statusTone[p.status ?? ''] ?? 'neutral'}>{p.status ?? 'planned'}</Badge>
                      </span>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/dashboard/promos/${p.id}`}>
                          <Button variant="ghost" className="px-2 py-1 text-xs">
                            Open
                          </Button>
                        </Link>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openClone(p)}>
                          Clone
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300"
                          onClick={() => remove(p)}
                        >
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

      {/* create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New promo"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={busy}>
              {busy ? <Spinner className="mr-2" /> : null}
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formErr && <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{formErr}</div>}
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Summer 25% Off Apparel"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={form.promo_type}
                onChange={(e) => setForm({ ...form, promo_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                {PROMO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Discount depth (%)">
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={form.discount_depth}
                onChange={(e) => setForm({ ...form, discount_depth: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="date"
                value={form.start_at}
                onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
            <Field label="End">
              <input
                type="date"
                value={form.end_at}
                onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Campaign tag">
              <input
                value={form.campaign_tag}
                onChange={(e) => setForm({ ...form, campaign_tag: e.target.value })}
                placeholder="links orders to this promo"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
            <Field label="Owner">
              <input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
        </div>
      </Modal>

      {/* clone modal */}
      <Modal
        open={!!cloneTarget}
        onClose={() => setCloneTarget(null)}
        title={cloneTarget ? `Clone "${cloneTarget.name}"` : 'Clone promo'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloneTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitClone} disabled={busy}>
              {busy ? <Spinner className="mr-2" /> : null}
              Clone
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {cloneErr && <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{cloneErr}</div>}
          <p className="text-xs text-slate-400">
            Clones the promo&apos;s type, depth, eligible SKUs and channel scope into a fresh planned promo with a new
            name and window.
          </p>
          <Field label="New name">
            <input
              value={cloneForm.name}
              onChange={(e) => setCloneForm({ ...cloneForm, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (optional)">
              <input
                type="date"
                value={cloneForm.start_at}
                onChange={(e) => setCloneForm({ ...cloneForm, start_at: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
            <Field label="End (optional)">
              <input
                type="date"
                value={cloneForm.end_at}
                onChange={(e) => setCloneForm({ ...cloneForm, end_at: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
