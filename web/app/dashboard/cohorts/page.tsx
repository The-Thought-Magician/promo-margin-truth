'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'

interface Promo {
  id: string
  name: string
  status: string
}

interface Cohort {
  id: string
  user_id: string
  promo_id: string | null
  name: string
  customer_count: number
  repeat_rate: number
  customer_ids: string[] | null
  created_at: string
}

interface Segment {
  id: string
  user_id: string
  name: string
  kind: string
  criteria: Record<string, unknown> | null
  created_at: string
}

const SEGMENT_KINDS = ['control', 'audience', 'exclusion', 'lookalike'] as const

function pct(v: number): string {
  return `${((v ?? 0) * 100).toFixed(1)}%`
}

function kindTone(kind: string): 'sky' | 'fuchsia' | 'amber' | 'green' | 'neutral' {
  switch (kind) {
    case 'control':
      return 'sky'
    case 'audience':
      return 'fuchsia'
    case 'exclusion':
      return 'amber'
    case 'lookalike':
      return 'green'
    default:
      return 'neutral'
  }
}

export default function CohortsPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // cohort build
  const [buildPromoId, setBuildPromoId] = useState('')
  const [building, setBuilding] = useState(false)
  const [busyCohort, setBusyCohort] = useState<string | null>(null)

  // segment modal
  const [segModalOpen, setSegModalOpen] = useState(false)
  const [editSeg, setEditSeg] = useState<Segment | null>(null)
  const [segName, setSegName] = useState('')
  const [segKind, setSegKind] = useState<string>('control')
  const [segCriteria, setSegCriteria] = useState('{\n  \n}')
  const [segSaving, setSegSaving] = useState(false)
  const [segFormError, setSegFormError] = useState<string | null>(null)
  const [busySeg, setBusySeg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [c, s, p] = await Promise.all([api.getCohorts(), api.getSegments(), api.getPromos()])
      setCohorts(Array.isArray(c) ? c : [])
      setSegments(Array.isArray(s) ? s : [])
      const list: Promo[] = Array.isArray(p) ? p : []
      setPromos(list)
      if (list.length > 0) setBuildPromoId((prev) => prev || list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cohorts and segments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function buildCohort() {
    if (!buildPromoId) return
    setBuilding(true)
    setError(null)
    try {
      await api.buildCohort({ promo_id: buildPromoId })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build cohort')
    } finally {
      setBuilding(false)
    }
  }

  async function removeCohort(id: string) {
    if (!confirm('Delete this cohort?')) return
    setBusyCohort(id)
    setError(null)
    try {
      await api.deleteCohort(id)
      setCohorts((prev) => prev.filter((c) => c.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete cohort')
    } finally {
      setBusyCohort(null)
    }
  }

  function openCreateSeg() {
    setEditSeg(null)
    setSegName('')
    setSegKind('control')
    setSegCriteria('{\n  \n}')
    setSegFormError(null)
    setSegModalOpen(true)
  }

  function openEditSeg(s: Segment) {
    setEditSeg(s)
    setSegName(s.name)
    setSegKind(s.kind)
    setSegCriteria(JSON.stringify(s.criteria ?? {}, null, 2))
    setSegFormError(null)
    setSegModalOpen(true)
  }

  async function saveSeg() {
    setSegFormError(null)
    if (!segName.trim()) {
      setSegFormError('Name is required.')
      return
    }
    let criteria: Record<string, unknown>
    try {
      const parsed = segCriteria.trim() ? JSON.parse(segCriteria) : {}
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Criteria must be a JSON object.')
      }
      criteria = parsed
    } catch (e) {
      setSegFormError(e instanceof Error ? `Invalid criteria JSON: ${e.message}` : 'Invalid criteria JSON')
      return
    }
    setSegSaving(true)
    try {
      const body = { name: segName.trim(), kind: segKind, criteria }
      if (editSeg) {
        await api.updateSegment(editSeg.id, body)
      } else {
        await api.createSegment(body)
      }
      setSegModalOpen(false)
      await load()
    } catch (e) {
      setSegFormError(e instanceof Error ? e.message : 'Failed to save segment')
    } finally {
      setSegSaving(false)
    }
  }

  async function removeSeg(id: string) {
    if (!confirm('Delete this segment?')) return
    setBusySeg(id)
    setError(null)
    try {
      await api.deleteSegment(id)
      setSegments((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete segment')
    } finally {
      setBusySeg(null)
    }
  }

  const promoName = (id: string | null) => (id ? promos.find((p) => p.id === id)?.name ?? id.slice(0, 8) : '—')

  const cohortTotals = useMemo(() => {
    const customers = cohorts.reduce((s, c) => s + (c.customer_count ?? 0), 0)
    const avgRepeat = cohorts.length
      ? cohorts.reduce((s, c) => s + (c.repeat_rate ?? 0), 0) / cohorts.length
      : 0
    return { customers, avgRepeat }
  }, [cohorts])

  if (loading) return <FullPageSpinner label="Loading cohorts and segments..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cohorts &amp; Segments</h1>
        <p className="mt-1 text-sm text-slate-400">
          Build acquisition cohorts per promo and define the control groups and segments your analysis leans on.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Cohorts" value={cohorts.length} />
        <Stat label="Customers tracked" value={cohortTotals.customers.toLocaleString('en-US')} />
        <Stat label="Avg repeat rate" value={pct(cohortTotals.avgRepeat)} tone="positive" />
      </div>

      {/* Cohort builder */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Acquisition cohorts</h2>
            <p className="mt-1 text-xs text-slate-400">Build a cohort of customers acquired by a specific promo.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Promo</span>
              <select
                value={buildPromoId}
                onChange={(e) => setBuildPromoId(e.target.value)}
                disabled={promos.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none sm:w-64"
              >
                {promos.length === 0 ? (
                  <option value="">No promos</option>
                ) : (
                  promos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <Button onClick={buildCohort} disabled={building || !buildPromoId}>
              {building ? <Spinner className="mr-2" /> : null}
              {building ? 'Building...' : 'Build cohort'}
            </Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {cohorts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No cohorts yet"
                description="Pick a promo above and build your first acquisition cohort."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Cohort</TH>
                  <TH>Promo</TH>
                  <TH>Customers</TH>
                  <TH>Repeat rate</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {cohorts.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-200">{c.name}</TD>
                    <TD className="text-slate-300">{promoName(c.promo_id)}</TD>
                    <TD>{(c.customer_count ?? 0).toLocaleString('en-US')}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-200">{pct(c.repeat_rate)}</span>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, Math.round((c.repeat_rate ?? 0) * 100))}%` }}
                          />
                        </div>
                      </div>
                    </TD>
                    <TD className="text-slate-400">{c.created_at?.slice(0, 10) ?? '—'}</TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          variant="danger"
                          className="px-2.5 py-1 text-xs"
                          disabled={busyCohort === c.id}
                          onClick={() => removeCohort(c.id)}
                        >
                          {busyCohort === c.id ? <Spinner /> : 'Delete'}
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

      {/* Segments */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Control &amp; segment definitions</h2>
            <p className="mt-1 text-xs text-slate-400">Reusable control groups and audience segments.</p>
          </div>
          <Button onClick={openCreateSeg}>New segment</Button>
        </CardHeader>
        <CardBody className="p-0">
          {segments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No segments defined"
                description="Define a control group or audience segment to power incrementality analysis."
                action={<Button onClick={openCreateSeg}>New segment</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Kind</TH>
                  <TH>Criteria</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {segments.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-slate-200">{s.name}</TD>
                    <TD>
                      <Badge tone={kindTone(s.kind)}>{s.kind}</Badge>
                    </TD>
                    <TD className="max-w-xs">
                      <code className="block truncate font-mono text-[11px] text-slate-400">
                        {s.criteria && Object.keys(s.criteria).length ? JSON.stringify(s.criteria) : '—'}
                      </code>
                    </TD>
                    <TD className="text-slate-400">{s.created_at?.slice(0, 10) ?? '—'}</TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => openEditSeg(s)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="px-2.5 py-1 text-xs"
                          disabled={busySeg === s.id}
                          onClick={() => removeSeg(s.id)}
                        >
                          {busySeg === s.id ? <Spinner /> : 'Delete'}
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
        open={segModalOpen}
        onClose={() => setSegModalOpen(false)}
        title={editSeg ? 'Edit segment' : 'New segment'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSegModalOpen(false)} disabled={segSaving}>
              Cancel
            </Button>
            <Button onClick={saveSeg} disabled={segSaving}>
              {segSaving ? <Spinner className="mr-2" /> : null}
              {segSaving ? 'Saving...' : 'Save segment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {segFormError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {segFormError}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={segName}
              onChange={(e) => setSegName(e.target.value)}
              placeholder="e.g. Holdout control"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Kind</span>
            <select
              value={segKind}
              onChange={(e) => setSegKind(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {SEGMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Criteria (JSON)</span>
            <textarea
              value={segCriteria}
              onChange={(e) => setSegCriteria(e.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              placeholder='{ "channel": "email", "first_order": true }'
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
