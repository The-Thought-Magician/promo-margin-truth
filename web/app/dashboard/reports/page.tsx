'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Report {
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

const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const looksMoney = (k: string) => /cents|revenue|contribution|discount|cogs|fee|dollars|destroyed|recoverable/i.test(k)
const fmtMoney = (cents: number) =>
  ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function formatValue(key: string, value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    if (key.endsWith('_cents') || (looksMoney(key) && Math.abs(value) >= 100)) return fmtMoney(value)
    if (/pct|ratio|rate/i.test(key)) {
      const v = Math.abs(value) <= 1 ? value * 100 : value
      return `${v.toFixed(1)}%`
    }
    return value.toLocaleString('en-US')
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value
  return ''
}

function PayloadView({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload || Object.keys(payload).length === 0) {
    return <p className="text-sm text-slate-500">This report has no stored payload.</p>
  }
  const scalars: Array<[string, unknown]> = []
  const arrays: Array<[string, Record<string, unknown>[]]> = []
  const objects: Array<[string, Record<string, unknown>]> = []

  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null) arrays.push([k, v as Record<string, unknown>[]])
      else scalars.push([k, v.join(', ')])
    } else if (v !== null && typeof v === 'object') {
      objects.push([k, v as Record<string, unknown>])
    } else {
      scalars.push([k, v])
    }
  }

  return (
    <div className="space-y-6">
      {scalars.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">{k.replace(/_/g, ' ')}</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{formatValue(k, v)}</div>
            </div>
          ))}
        </div>
      )}

      {objects.map(([k, obj]) => (
        <div key={k}>
          <div className="mb-2 text-sm font-semibold capitalize text-slate-300">{k.replace(/_/g, ' ')}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(obj).map(([ik, iv]) => (
              <div key={ik} className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">{ik.replace(/_/g, ' ')}</div>
                <div className="mt-1 text-base font-semibold text-slate-100">
                  {typeof iv === 'object' && iv !== null ? JSON.stringify(iv) : formatValue(ik, iv)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {arrays.map(([k, rows]) => {
        const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
        return (
          <div key={k}>
            <div className="mb-2 text-sm font-semibold capitalize text-slate-300">{k.replace(/_/g, ' ')}</div>
            <Table>
              <THead>
                <TR>
                  {cols.map((c) => (
                    <TH key={c}>{c.replace(/_/g, ' ')}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <TR key={i}>
                    {cols.map((c) => (
                      <TD key={c} className="tabular-nums">
                        {typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : formatValue(c, r[c])}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )
      })}
    </div>
  )
}

const KIND_TONE: Record<string, 'fuchsia' | 'sky' | 'amber' | 'green' | 'neutral'> = {
  retrospective: 'fuchsia',
  period: 'sky',
  teardown: 'amber',
  recovery: 'green',
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Report | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')

  const loadList = async () => {
    setLoading(true)
    setError(null)
    try {
      const r: Report[] = await api.getReports()
      setReports(r ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadList()
  }, [])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const r: Report = await api.getReport(id)
      setDetail(r)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setDetailLoading(false)
    }
  }

  const rerun = async (id: string) => {
    setBusyId(id)
    try {
      const updated: Report = await api.rerunReport(id)
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)))
      if (selectedId === id) setDetail(updated)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to rerun report')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (r: Report) => {
    if (!confirm(`Delete report "${r.title}"?`)) return
    setBusyId(r.id)
    try {
      await api.deleteReport(r.id)
      setReports((prev) => prev.filter((x) => x.id !== r.id))
      if (selectedId === r.id) {
        setSelectedId(null)
        setDetail(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setBusyId(null)
    }
  }

  const kinds = useMemo(() => ['all', ...Array.from(new Set(reports.map((r) => r.kind)))], [reports])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.scope.toLowerCase().includes(q) ||
        (r.scope_id ?? '').toLowerCase().includes(q)
      )
    })
  }, [reports, search, kindFilter])

  if (loading) return <FullPageSpinner label="Loading reports..." />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Reports Library</h1>
        <p className="mt-1 text-sm text-slate-400">
          Browse generated retrospectives and period teardowns, re-run them against the latest data, or open one to inspect its full payload.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {reports.length === 0 && !error ? (
        <EmptyState
          title="No reports yet"
          description="Generate a promo retrospective or period teardown from the Retrospective page to populate your library."
          icon="📄"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Library */}
          <Card className="self-start">
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Library</div>
                <span className="text-xs text-slate-500">{filtered.length} reports</span>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, scope..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5">
                {kinds.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(k)}
                    className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                      kindFilter === k
                        ? 'border-fuchsia-700 bg-fuchsia-950/50 text-fuchsia-300'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No reports match your filters.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Report</TH>
                      <TH>Created</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => (
                      <TR
                        key={r.id}
                        onClick={() => openDetail(r.id)}
                        className={`cursor-pointer ${selectedId === r.id ? 'bg-fuchsia-950/30' : ''}`}
                      >
                        <TD>
                          <div className="font-medium text-slate-100">{r.title}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge tone={KIND_TONE[r.kind] ?? 'neutral'}>{r.kind}</Badge>
                            <span className="text-xs text-slate-500">{r.scope}</span>
                          </div>
                        </TD>
                        <TD className="whitespace-nowrap text-xs text-slate-400">{fmtDate(r.created_at)}</TD>
                        <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              onClick={() => rerun(r.id)}
                              disabled={busyId === r.id}
                              className="px-2 py-1"
                            >
                              {busyId === r.id ? <Spinner /> : 'Re-run'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => remove(r)}
                              disabled={busyId === r.id}
                              className="px-2 py-1 text-rose-400 hover:text-rose-300"
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

          {/* Detail viewer */}
          <Card className="self-start">
            <CardHeader className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">
                {detail ? detail.title : 'Report detail'}
              </div>
              {detail && (
                <Button
                  variant="secondary"
                  onClick={() => rerun(detail.id)}
                  disabled={busyId === detail.id}
                  className="px-3 py-1.5"
                >
                  {busyId === detail.id ? <Spinner className="mr-2" /> : null}
                  Re-run
                </Button>
              )}
            </CardHeader>
            <CardBody>
              {!selectedId ? (
                <EmptyState
                  title="Select a report"
                  description="Choose a report from the library to view its full breakdown."
                  icon="👈"
                />
              ) : detailLoading ? (
                <div className="flex items-center gap-3 py-8 text-sm text-slate-400">
                  <Spinner /> Loading report...
                </div>
              ) : detailError ? (
                <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
                  {detailError}
                </div>
              ) : detail ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <Badge tone={KIND_TONE[detail.kind] ?? 'neutral'}>{detail.kind}</Badge>
                    <span>Scope: {detail.scope}{detail.scope_id ? ` · ${detail.scope_id}` : ''}</span>
                    <span>·</span>
                    <span>
                      Period: {fmtDate(detail.period_start)} → {fmtDate(detail.period_end)}
                    </span>
                    <span>·</span>
                    <span>Generated {fmtDate(detail.created_at)}</span>
                  </div>
                  <PayloadView payload={detail.payload} />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
