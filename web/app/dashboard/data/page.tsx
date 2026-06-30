'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface IngestionRun {
  id: string
  filename?: string
  source?: string
  row_count?: number
  error_count?: number
  status?: string
  summary?: unknown
  errors?: unknown
  created_at?: string
}

const CANONICAL = [
  'order_id',
  'sku_code',
  'qty',
  'unit_price_cents',
  'discount_amount_cents',
  'cogs_unit_cents',
  'customer_id',
  'order_ts',
  'campaign_tag',
  'channel',
  'is_first_order',
]

// Parse a CSV string into header + row objects. Handles quoted fields and commas.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const splitLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
        } else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }
  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

// Coerce a parsed CSV row to an OrderLineInput, applying header->canonical mapping if provided.
function toOrderLine(row: Record<string, string>, headers: string[], mapping: Record<string, string> | null) {
  const get = (canon: string): string => {
    if (mapping) {
      const srcHeader = Object.keys(mapping).find((h) => mapping[h] === canon)
      if (srcHeader) return row[srcHeader] ?? ''
    }
    // direct header match
    if (headers.includes(canon)) return row[canon] ?? ''
    return ''
  }
  const num = (s: string) => {
    const n = Number(String(s).replace(/[$,]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  const cents = (s: string) => {
    const raw = String(s).replace(/[$,]/g, '')
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    // if it has a decimal point, treat as dollars
    return raw.includes('.') ? Math.round(n * 100) : Math.round(n)
  }
  return {
    order_id: get('order_id') || undefined,
    sku_code: get('sku_code'),
    qty: num(get('qty')) || 1,
    unit_price_cents: cents(get('unit_price_cents')),
    discount_amount_cents: cents(get('discount_amount_cents')),
    cogs_unit_cents: get('cogs_unit_cents') ? cents(get('cogs_unit_cents')) : undefined,
    customer_id: get('customer_id') || undefined,
    order_ts: get('order_ts') || undefined,
    campaign_tag: get('campaign_tag') || undefined,
    channel: get('channel') || undefined,
    is_first_order: /^(1|true|yes|y)$/i.test(get('is_first_order')),
  }
}

const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString() : '—')

export default function DataPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<IngestionRun[]>([])
  const [mappings, setMappings] = useState<{ id: string; name?: string; mapping?: Record<string, string> }[]>([])
  const [seeding, setSeeding] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'green' | 'red' } | null>(null)
  const [search, setSearch] = useState('')

  // upload modal state
  const [uploadOpen, setUploadOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [mappingId, setMappingId] = useState<string>('')
  const fileInput = useRef<HTMLInputElement>(null)

  // detail modal
  const [detail, setDetail] = useState<IngestionRun | null>(null)

  const showToast = (msg: string, tone: 'green' | 'red') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 4000)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, m] = await Promise.all([
        api.getIngestionRuns().catch(() => []),
        api.getMappings().catch(() => []),
      ])
      setRuns(Array.isArray(r) ? r : [])
      setMappings(Array.isArray(m) ? m : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ingestion runs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onFile = async (f: File) => {
    const text = await f.text()
    const p = parseCsv(text)
    setParsed(p)
    setFileName(f.name)
    setUploadOpen(true)
  }

  const doUpload = async () => {
    if (!parsed || parsed.rows.length === 0) return
    setUploading(true)
    try {
      const chosen = mappings.find((m) => m.id === mappingId)
      const map = chosen?.mapping ?? null
      const rows = parsed.rows.map((row) => toOrderLine(row, parsed.headers, map ?? null))
      await api.uploadData({ filename: fileName, rows, mappingName: chosen?.name })
      showToast(`Ingested ${rows.length} rows from ${fileName}`, 'green')
      setUploadOpen(false)
      setParsed(null)
      setFileName('')
      setMappingId('')
      if (fileInput.current) fileInput.current.value = ''
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'red')
    } finally {
      setUploading(false)
    }
  }

  const seed = async () => {
    setSeeding(true)
    try {
      const res = await api.seedSampleData()
      const sk = res?.skus?.length ?? 0
      const pr = res?.promos?.length ?? 0
      showToast(`Seeded sample brand: ${sk} SKUs, ${pr} promos`, 'green')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Seed failed', 'red')
    } finally {
      setSeeding(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this ingestion run and all its order lines?')) return
    const prev = runs
    setRuns((rs) => rs.filter((r) => r.id !== id))
    try {
      await api.deleteIngestionRun(id)
      showToast('Run deleted', 'green')
    } catch (e) {
      setRuns(prev)
      showToast(e instanceof Error ? e.message : 'Delete failed', 'red')
    }
  }

  const filtered = runs.filter((r) =>
    !search.trim() ? true : (r.filename ?? '').toLowerCase().includes(search.toLowerCase()) || (r.source ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const totalRows = runs.reduce((a, r) => a + (r.row_count ?? 0), 0)
  const totalErrors = runs.reduce((a, r) => a + (r.error_count ?? 0), 0)

  const statusTone = (s?: string): 'green' | 'red' | 'amber' | 'neutral' => {
    if (s === 'completed' || s === 'success') return 'green'
    if (s === 'failed' || s === 'error') return 'red'
    if (s === 'partial' || s === 'warning') return 'amber'
    return 'neutral'
  }

  if (loading) return <FullPageSpinner label="Loading data ingestion..." />

  return (
    <div className="space-y-8">
      {toast && (
        <div className={`fixed right-6 top-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${toast.tone === 'green' ? 'border-emerald-800 bg-emerald-950/90 text-emerald-300' : 'border-rose-800 bg-rose-950/90 text-rose-300'}`}>
          {toast.msg}
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Data Ingestion</h1>
          <p className="mt-1 text-sm text-slate-400">Upload order CSVs, seed a sample brand, and track ingestion runs.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/data/map">
            <Button variant="ghost">Column Mapping</Button>
          </Link>
          <Button variant="secondary" onClick={seed} disabled={seeding}>
            {seeding ? <span className="flex items-center gap-2"><Spinner /> Seeding...</span> : 'Seed sample data'}
          </Button>
          <Button onClick={() => fileInput.current?.click()}>Upload CSV</Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
          {error} <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ingestion Runs" value={runs.length} />
        <Stat label="Rows Ingested" value={totalRows.toLocaleString()} />
        <Stat label="Row Errors" value={totalErrors.toLocaleString()} tone={totalErrors > 0 ? 'negative' : 'default'} />
      </section>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Ingestion Runs</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename or source..."
            className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-600 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="📥"
                title={runs.length === 0 ? 'No ingestion runs yet' : 'No runs match your search'}
                description={runs.length === 0 ? 'Upload a CSV of order lines or seed the sample brand to get started.' : 'Try a different search term.'}
                action={
                  runs.length === 0 ? (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={seed} disabled={seeding}>Seed sample</Button>
                      <Button onClick={() => fileInput.current?.click()}>Upload CSV</Button>
                    </div>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Filename</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-white">{r.filename ?? '(unnamed)'}</TD>
                    <TD className="text-slate-400">{r.source ?? '—'}</TD>
                    <TD className="text-right">{(r.row_count ?? 0).toLocaleString()}</TD>
                    <TD className={`text-right ${(r.error_count ?? 0) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{r.error_count ?? 0}</TD>
                    <TD><Badge tone={statusTone(r.status)}>{r.status ?? 'unknown'}</Badge></TD>
                    <TD className="text-slate-400">{fmtDate(r.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setDetail(r)}>Details</Button>
                        <Button variant="danger" onClick={() => remove(r.id)}>Delete</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Upload preview modal */}
      <Modal
        open={uploadOpen}
        onClose={() => { if (!uploading) { setUploadOpen(false); setParsed(null) } }}
        title="Confirm upload"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setUploadOpen(false); setParsed(null) }} disabled={uploading}>Cancel</Button>
            <Button onClick={doUpload} disabled={uploading || !parsed || parsed.rows.length === 0}>
              {uploading ? <span className="flex items-center gap-2"><Spinner /> Ingesting...</span> : `Ingest ${parsed?.rows.length ?? 0} rows`}
            </Button>
          </>
        }
      >
        {parsed && (
          <div className="space-y-4">
            <div className="text-sm text-slate-300">
              <span className="font-medium text-white">{fileName}</span> — {parsed.rows.length} rows, {parsed.headers.length} columns
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Column mapping</label>
              <select
                value={mappingId}
                onChange={(e) => setMappingId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-600 focus:outline-none"
              >
                <option value="">Auto-detect by header name</option>
                {mappings.map((m) => (
                  <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                ))}
              </select>
              {mappings.length === 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  No saved mappings. Headers will be matched directly to canonical columns. <Link href="/dashboard/data/map" className="text-fuchsia-400 underline">Create a mapping</Link>.
                </p>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Detected headers</div>
              <div className="flex flex-wrap gap-1">
                {parsed.headers.map((h) => (
                  <span key={h} className={`rounded border px-2 py-0.5 text-xs ${CANONICAL.includes(h) ? 'border-fuchsia-800 bg-fuchsia-950/50 text-fuchsia-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{h}</span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/80 text-slate-500">
                  <tr>{parsed.headers.map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>{parsed.headers.map((h) => <td key={h} className="px-2 py-1 text-slate-300">{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Run detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.filename ?? 'Run detail'}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs uppercase text-slate-500">Status</div><Badge tone={statusTone(detail.status)}>{detail.status ?? 'unknown'}</Badge></div>
              <div><div className="text-xs uppercase text-slate-500">Source</div><div className="text-slate-200">{detail.source ?? '—'}</div></div>
              <div><div className="text-xs uppercase text-slate-500">Rows</div><div className="text-slate-200">{detail.row_count ?? 0}</div></div>
              <div><div className="text-xs uppercase text-slate-500">Errors</div><div className={(detail.error_count ?? 0) > 0 ? 'text-rose-400' : 'text-slate-200'}>{detail.error_count ?? 0}</div></div>
            </div>
            {detail.summary != null && (
              <div>
                <div className="mb-1 text-xs uppercase text-slate-500">Summary</div>
                <pre className="max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">{JSON.stringify(detail.summary, null, 2)}</pre>
              </div>
            )}
            {Array.isArray(detail.errors) && detail.errors.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase text-slate-500">Errors</div>
                <pre className="max-h-40 overflow-auto rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-xs text-rose-300">{JSON.stringify(detail.errors, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
