'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Sku {
  id: string
  sku_code: string
  name: string
  collection: string | null
  list_price_cents: number
  cogs_unit_cents: number
}

interface CogsOverride {
  id: string
  sku_id: string
  cogs_unit_cents: number
  effective_from: string | null
  note: string | null
  created_at?: string
}

const money = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

const fmtDate = (ts: string | null | undefined) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

const emptyForm = { sku_code: '', name: '', collection: '', list_price: '', cogs_unit: '' }

export default function SkusPage() {
  const [skus, setSkus] = useState<Sku[]>([])
  const [missing, setMissing] = useState<Sku[]>([])
  const [overrides, setOverrides] = useState<CogsOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  // create / edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState<string | null>(null)

  // bulk import modal
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkErr, setBulkErr] = useState<string | null>(null)

  // cogs override modal
  const [ovOpen, setOvOpen] = useState(false)
  const [ovSku, setOvSku] = useState<Sku | null>(null)
  const [ovForm, setOvForm] = useState({ cogs_unit: '', effective_from: '', note: '' })
  const [ovErr, setOvErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, m, o] = await Promise.all([api.getSkus(), api.getMissingCogs(), api.getCogsOverrides()])
      setSkus(Array.isArray(s) ? s : [])
      setMissing(Array.isArray(m) ? m : [])
      setOverrides(Array.isArray(o) ? o : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SKUs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const overridesBySku = useMemo(() => {
    const map = new Map<string, CogsOverride[]>()
    for (const o of overrides) {
      const arr = map.get(o.sku_id) ?? []
      arr.push(o)
      map.set(o.sku_id, arr)
    }
    return map
  }, [overrides])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skus
    return skus.filter(
      (s) =>
        s.sku_code?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        (s.collection ?? '').toLowerCase().includes(q),
    )
  }, [skus, search])

  const totals = useMemo(() => {
    const count = skus.length
    const missingCount = missing.length
    let avgMargin = 0
    let withPrice = 0
    for (const s of skus) {
      if (s.list_price_cents > 0) {
        avgMargin += ((s.list_price_cents - s.cogs_unit_cents) / s.list_price_cents) * 100
        withPrice++
      }
    }
    return {
      count,
      missingCount,
      avgMargin: withPrice > 0 ? avgMargin / withPrice : 0,
      coverage: count > 0 ? ((count - missingCount) / count) * 100 : 0,
    }
  }, [skus, missing])

  // ---- create / edit ----
  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm)
    setFormErr(null)
    setModalOpen(true)
  }

  const openEdit = (s: Sku) => {
    setEditId(s.id)
    setForm({
      sku_code: s.sku_code,
      name: s.name,
      collection: s.collection ?? '',
      list_price: (s.list_price_cents / 100).toString(),
      cogs_unit: (s.cogs_unit_cents / 100).toString(),
    })
    setFormErr(null)
    setModalOpen(true)
  }

  const submitSku = async () => {
    setFormErr(null)
    if (!form.sku_code.trim() || !form.name.trim()) {
      setFormErr('SKU code and name are required.')
      return
    }
    const list = Math.round(parseFloat(form.list_price || '0') * 100)
    const cogs = Math.round(parseFloat(form.cogs_unit || '0') * 100)
    if (isNaN(list) || isNaN(cogs) || list < 0 || cogs < 0) {
      setFormErr('Prices must be valid non-negative numbers.')
      return
    }
    const payload = {
      sku_code: form.sku_code.trim(),
      name: form.name.trim(),
      collection: form.collection.trim() || null,
      list_price_cents: list,
      cogs_unit_cents: cogs,
    }
    setBusy(true)
    try {
      if (editId) await api.updateSku(editId, payload)
      else await api.createSku(payload)
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const removeSku = async (s: Sku) => {
    if (!confirm(`Delete SKU ${s.sku_code}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await api.deleteSku(s.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  // ---- bulk import (CSV: sku_code,name,collection,list_price,cogs_unit) ----
  const submitBulk = async () => {
    setBulkErr(null)
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      setBulkErr('Paste at least one row.')
      return
    }
    const rows: Array<Record<string, unknown>> = []
    for (const [i, line] of lines.entries()) {
      const parts = line.split(',').map((p) => p.trim())
      // skip a header row if present
      if (i === 0 && parts[0].toLowerCase() === 'sku_code') continue
      const [sku_code, name, collection, list_price, cogs_unit] = parts
      if (!sku_code || !name) {
        setBulkErr(`Row ${i + 1}: sku_code and name are required.`)
        return
      }
      const list = Math.round(parseFloat(list_price || '0') * 100)
      const cogs = Math.round(parseFloat(cogs_unit || '0') * 100)
      if (isNaN(list) || isNaN(cogs)) {
        setBulkErr(`Row ${i + 1}: invalid price/cogs number.`)
        return
      }
      rows.push({
        sku_code,
        name,
        collection: collection || null,
        list_price_cents: list,
        cogs_unit_cents: cogs,
      })
    }
    if (rows.length === 0) {
      setBulkErr('No data rows found.')
      return
    }
    setBusy(true)
    try {
      await api.bulkImportSkus(rows)
      setBulkOpen(false)
      setBulkText('')
      await load()
    } catch (e) {
      setBulkErr(e instanceof Error ? e.message : 'Bulk import failed')
    } finally {
      setBusy(false)
    }
  }

  // ---- cogs override ----
  const openOverride = (s: Sku) => {
    setOvSku(s)
    setOvForm({ cogs_unit: (s.cogs_unit_cents / 100).toString(), effective_from: '', note: '' })
    setOvErr(null)
    setOvOpen(true)
  }

  const submitOverride = async () => {
    if (!ovSku) return
    setOvErr(null)
    const cogs = Math.round(parseFloat(ovForm.cogs_unit || '0') * 100)
    if (isNaN(cogs) || cogs < 0) {
      setOvErr('COGS must be a valid non-negative number.')
      return
    }
    const payload: Record<string, unknown> = {
      sku_id: ovSku.id,
      cogs_unit_cents: cogs,
      note: ovForm.note.trim() || null,
    }
    if (ovForm.effective_from) payload.effective_from = new Date(ovForm.effective_from).toISOString()
    setBusy(true)
    try {
      await api.createCogsOverride(payload)
      setOvOpen(false)
      await load()
    } catch (e) {
      setOvErr(e instanceof Error ? e.message : 'Override failed')
    } finally {
      setBusy(false)
    }
  }

  const removeOverride = async (id: string) => {
    if (!confirm('Delete this COGS override?')) return
    setBusy(true)
    try {
      await api.deleteCogsOverride(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading SKUs & COGS..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">SKUs &amp; COGS</h1>
          <p className="mt-1 text-sm text-slate-400">
            Catalog, unit cost and cost overrides. Missing COGS silently corrupts every margin number — keep this clean.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setBulkOpen(true)}>
            Bulk import
          </Button>
          <Button onClick={openCreate}>+ New SKU</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total SKUs" value={totals.count.toLocaleString()} />
        <Stat
          label="Missing COGS"
          value={totals.missingCount.toLocaleString()}
          tone={totals.missingCount > 0 ? 'negative' : 'positive'}
          hint={totals.missingCount > 0 ? 'margins are unreliable' : 'all costed'}
        />
        <Stat label="COGS Coverage" value={`${totals.coverage.toFixed(0)}%`} />
        <Stat label="Avg List Margin" value={`${totals.avgMargin.toFixed(1)}%`} />
      </div>

      {/* Missing-COGS warning panel */}
      {missing.length > 0 && (
        <Card className="border-amber-800/60 bg-amber-950/20">
          <CardHeader className="border-amber-800/40">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              <h2 className="text-sm font-semibold text-amber-200">
                {missing.length} SKU{missing.length === 1 ? '' : 's'} with no COGS
              </h2>
            </div>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-amber-200/80">
              These SKUs have a unit cost of $0.00. Any promo touching them will show inflated contribution and margin.
              Set a cost or add a COGS override.
            </p>
            <div className="flex flex-wrap gap-2">
              {missing.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openEdit(s)}
                  className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-left text-xs text-amber-100 hover:bg-amber-900/40"
                >
                  <span className="font-mono">{s.sku_code}</span>
                  <span className="ml-2 text-amber-300/70">{s.name}</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Catalog</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code / name / collection"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody>
          {skus.length === 0 ? (
            <EmptyState
              title="No SKUs yet"
              description="Add a SKU manually, bulk-import a CSV, or seed the sample brand from the Ingestion page."
              action={<Button onClick={openCreate}>+ New SKU</Button>}
            />
          ) : visible.length === 0 ? (
            <EmptyState title="No matches" description="No SKUs match your search." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>SKU</TH>
                  <TH>Name</TH>
                  <TH>Collection</TH>
                  <TH className="text-right">List</TH>
                  <TH className="text-right">COGS/u</TH>
                  <TH className="text-right">Margin</TH>
                  <TH>Overrides</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((s) => {
                  const margin =
                    s.list_price_cents > 0 ? ((s.list_price_cents - s.cogs_unit_cents) / s.list_price_cents) * 100 : 0
                  const ovs = overridesBySku.get(s.id) ?? []
                  const noCogs = !s.cogs_unit_cents
                  return (
                    <TR key={s.id}>
                      <TD className="font-mono text-xs">{s.sku_code}</TD>
                      <TD>{s.name}</TD>
                      <TD className="text-slate-400">{s.collection || '—'}</TD>
                      <TD className="text-right tabular-nums">{money(s.list_price_cents)}</TD>
                      <TD className="text-right tabular-nums">
                        {noCogs ? <Badge tone="amber">missing</Badge> : money(s.cogs_unit_cents)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {s.list_price_cents > 0 ? (
                          <span className={margin < 0 ? 'text-rose-400' : margin < 20 ? 'text-amber-300' : 'text-emerald-400'}>
                            {margin.toFixed(1)}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>
                        {ovs.length > 0 ? (
                          <Badge tone="fuchsia">{ovs.length}</Badge>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openOverride(s)}>
                            COGS+
                          </Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300"
                            onClick={() => removeSku(s)}
                          >
                            Delete
                          </Button>
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

      {/* COGS overrides log */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">COGS Override History</h2>
        </CardHeader>
        <CardBody>
          {overrides.length === 0 ? (
            <EmptyState
              title="No overrides"
              description="COGS overrides let you record cost changes effective from a date (e.g. a supplier price hike) without rewriting the base SKU cost."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>SKU</TH>
                  <TH className="text-right">COGS/u</TH>
                  <TH>Effective From</TH>
                  <TH>Note</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {overrides.map((o) => {
                  const sku = skus.find((s) => s.id === o.sku_id)
                  return (
                    <TR key={o.id}>
                      <TD className="font-mono text-xs">{sku ? sku.sku_code : o.sku_id.slice(0, 8)}</TD>
                      <TD className="text-right tabular-nums">{money(o.cogs_unit_cents)}</TD>
                      <TD className="text-slate-400">{fmtDate(o.effective_from)}</TD>
                      <TD className="text-slate-400">{o.note || '—'}</TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300"
                          onClick={() => removeOverride(o.id)}
                        >
                          Delete
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

      {/* create / edit SKU modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'Edit SKU' : 'New SKU'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitSku} disabled={busy}>
              {busy ? <Spinner className="mr-2" /> : null}
              {editId ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formErr && <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{formErr}</div>}
          <Field label="SKU code">
            <input
              value={form.sku_code}
              onChange={(e) => setForm({ ...form, sku_code: e.target.value })}
              disabled={!!editId}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none disabled:opacity-60"
            />
          </Field>
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <Field label="Collection (optional)">
            <input
              value={form.collection}
              onChange={(e) => setForm({ ...form, collection: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="List price ($)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.list_price}
                onChange={(e) => setForm({ ...form, list_price: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
            <Field label="COGS / unit ($)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cogs_unit}
                onChange={(e) => setForm({ ...form, cogs_unit: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* bulk import modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk import SKUs"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitBulk} disabled={busy}>
              {busy ? <Spinner className="mr-2" /> : null}
              Import
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {bulkErr && <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{bulkErr}</div>}
          <p className="text-xs text-slate-400">
            One SKU per line, comma-separated:{' '}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-fuchsia-300">sku_code,name,collection,list_price,cogs_unit</code>
            . Prices in dollars. A header row is auto-skipped.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={8}
            placeholder={'TEE-001,Classic Tee,Apparel,29.00,8.50\nMUG-002,Logo Mug,Drinkware,14.00,4.25'}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
          />
        </div>
      </Modal>

      {/* cogs override modal */}
      <Modal
        open={ovOpen}
        onClose={() => setOvOpen(false)}
        title={ovSku ? `COGS override — ${ovSku.sku_code}` : 'COGS override'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOvOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitOverride} disabled={busy}>
              {busy ? <Spinner className="mr-2" /> : null}
              Add override
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {ovErr && <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{ovErr}</div>}
          <Field label="COGS / unit ($)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={ovForm.cogs_unit}
              onChange={(e) => setOvForm({ ...ovForm, cogs_unit: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <Field label="Effective from (optional)">
            <input
              type="date"
              value={ovForm.effective_from}
              onChange={(e) => setOvForm({ ...ovForm, effective_from: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <Field label="Note (optional)">
            <input
              value={ovForm.note}
              onChange={(e) => setOvForm({ ...ovForm, note: e.target.value })}
              placeholder="e.g. supplier price increase Q3"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
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
