'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface ColumnMapping {
  id: string
  name?: string
  mapping?: Record<string, string>
  created_at?: string
}

// Canonical order_line columns the backend understands.
const CANONICAL: { key: string; label: string; required?: boolean }[] = [
  { key: 'order_id', label: 'Order ID' },
  { key: 'sku_code', label: 'SKU code', required: true },
  { key: 'qty', label: 'Quantity', required: true },
  { key: 'unit_price_cents', label: 'Unit price (cents)', required: true },
  { key: 'discount_amount_cents', label: 'Discount amount (cents)' },
  { key: 'cogs_unit_cents', label: 'COGS / unit (cents)' },
  { key: 'customer_id', label: 'Customer ID' },
  { key: 'order_ts', label: 'Order timestamp' },
  { key: 'campaign_tag', label: 'Campaign tag' },
  { key: 'channel', label: 'Channel' },
  { key: 'is_first_order', label: 'Is first order' },
]

type MapPair = { header: string; canonical: string }

const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString() : '—')

export default function MapPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)
  const [saving, setSaving] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pairs, setPairs] = useState<MapPair[]>([{ header: '', canonical: 'sku_code' }])

  const showToast = (msg: string, tone: 'green' | 'red') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 4000)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const m = await api.getMappings()
      setMappings(Array.isArray(m) ? m : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mappings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditId(null)
    setName('')
    setPairs([{ header: '', canonical: 'sku_code' }])
    setEditorOpen(true)
  }

  const openEdit = (m: ColumnMapping) => {
    setEditId(m.id)
    setName(m.name ?? '')
    const entries = Object.entries(m.mapping ?? {})
    setPairs(entries.length > 0 ? entries.map(([header, canonical]) => ({ header, canonical })) : [{ header: '', canonical: 'sku_code' }])
    setEditorOpen(true)
  }

  const addPair = () => setPairs((p) => [...p, { header: '', canonical: '' }])
  const removePair = (i: number) => setPairs((p) => p.filter((_, idx) => idx !== i))
  const updatePair = (i: number, field: keyof MapPair, value: string) =>
    setPairs((p) => p.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))

  const buildMapping = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const { header, canonical } of pairs) {
      if (header.trim() && canonical.trim()) out[header.trim()] = canonical.trim()
    }
    return out
  }

  const save = async () => {
    const mapping = buildMapping()
    if (!name.trim()) { showToast('Mapping name is required', 'red'); return }
    if (Object.keys(mapping).length === 0) { showToast('Add at least one column mapping', 'red'); return }
    setSaving(true)
    try {
      if (editId) {
        await api.updateMapping(editId, { name: name.trim(), mapping })
        showToast('Mapping updated', 'green')
      } else {
        await api.createMapping({ name: name.trim(), mapping })
        showToast('Mapping created', 'green')
      }
      setEditorOpen(false)
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'red')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this column mapping?')) return
    const prev = mappings
    setMappings((m) => m.filter((x) => x.id !== id))
    try {
      await api.deleteMapping(id)
      showToast('Mapping deleted', 'green')
    } catch (e) {
      setMappings(prev)
      showToast(e instanceof Error ? e.message : 'Delete failed', 'red')
    }
  }

  const usedCanonical = new Set(pairs.map((p) => p.canonical).filter(Boolean))

  if (loading) return <FullPageSpinner label="Loading column mappings..." />

  return (
    <div className="space-y-8">
      {toast && (
        <div className={`fixed right-6 top-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${toast.tone === 'green' ? 'border-emerald-800 bg-emerald-950/90 text-emerald-300' : 'border-rose-800 bg-rose-950/90 text-rose-300'}`}>
          {toast.msg}
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Column Mapping</h1>
          <p className="mt-1 text-sm text-slate-400">
            Map your CSV headers to the canonical order-line columns so ingestion knows which field is which.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/data"><Button variant="ghost">Back to ingestion</Button></Link>
          <Button onClick={openCreate}>New mapping</Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {error} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Canonical columns</h2>
          <p className="mt-0.5 text-xs text-slate-500">These are the fields the ingestion engine maps every uploaded CSV into.</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {CANONICAL.map((c) => (
              <span key={c.key} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                <span className="font-mono text-fuchsia-300">{c.key}</span>
                {c.required && <span className="ml-1 text-rose-400">*</span>}
                <span className="ml-1 text-slate-500">{c.label}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-600"><span className="text-rose-400">*</span> required for a usable order line</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Saved mappings</h2>
          <Badge tone="fuchsia">{mappings.length}</Badge>
        </CardHeader>
        <CardBody className="p-0">
          {mappings.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="🧭"
                title="No mappings yet"
                description="Create a mapping to translate your CSV header names into the canonical columns ingestion expects."
                action={<Button onClick={openCreate}>New mapping</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Mapped columns</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {mappings.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium text-white">{m.name ?? '(unnamed)'}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(m.mapping ?? {}).map(([h, c]) => (
                          <span key={h} className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                            <span className="text-slate-300">{h}</span>
                            <span className="mx-1 text-fuchsia-500">→</span>
                            <span className="font-mono text-fuchsia-300">{c}</span>
                          </span>
                        ))}
                        {Object.keys(m.mapping ?? {}).length === 0 && <span className="text-xs text-slate-600">empty</span>}
                      </div>
                    </TD>
                    <TD className="text-slate-400">{fmtDate(m.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openEdit(m)}>Edit</Button>
                        <Button variant="danger" onClick={() => remove(m.id)}>Delete</Button>
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
        open={editorOpen}
        onClose={() => { if (!saving) setEditorOpen(false) }}
        title={editId ? 'Edit mapping' : 'New mapping'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <span className="flex items-center gap-2"><Spinner /> Saving...</span> : editId ? 'Save changes' : 'Create mapping'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Mapping name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shopify export"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Header → Canonical</label>
              <Button variant="ghost" onClick={addPair}>+ Add row</Button>
            </div>
            <div className="space-y-2">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={p.header}
                    onChange={(e) => updatePair(i, 'header', e.target.value)}
                    placeholder="CSV header name"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none"
                  />
                  <span className="text-fuchsia-500">→</span>
                  <select
                    value={p.canonical}
                    onChange={(e) => updatePair(i, 'canonical', e.target.value)}
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
                  >
                    <option value="">— select column —</option>
                    {CANONICAL.map((c) => (
                      <option key={c.key} value={c.key} disabled={usedCanonical.has(c.key) && p.canonical !== c.key}>
                        {c.key}{c.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removePair(i)}
                    className="rounded-lg border border-slate-700 px-2 py-2 text-slate-500 hover:border-rose-700 hover:text-rose-400"
                    aria-label="Remove row"
                    disabled={pairs.length === 1}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-600">Map each source CSV header to one canonical order-line column. Unmapped canonical columns fall back to direct header-name matching during ingestion.</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
