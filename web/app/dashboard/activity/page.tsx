'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface ActivityLog {
  id: string
  user_id: string
  action: string
  entity: string
  entity_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

const ENTITY_TONE: Record<string, 'fuchsia' | 'green' | 'red' | 'amber' | 'sky' | 'neutral'> = {
  promo: 'fuchsia',
  sku: 'sky',
  pnl: 'green',
  alert: 'red',
  ingestion_run: 'amber',
  scenario: 'sky',
  benchmark: 'green',
  report: 'fuchsia',
  workspace: 'neutral',
}

function entityTone(entity: string) {
  return ENTITY_TONE[entity] ?? 'neutral'
}

function actionTone(action: string): 'green' | 'red' | 'amber' | 'sky' | 'neutral' {
  const a = action.toLowerCase()
  if (a.includes('create') || a.includes('add') || a.includes('build') || a.includes('seed')) return 'green'
  if (a.includes('delete') || a.includes('remove')) return 'red'
  if (a.includes('update') || a.includes('edit') || a.includes('compute') || a.includes('fit')) return 'amber'
  if (a.includes('scan') || a.includes('upload') || a.includes('generate') || a.includes('rerun')) return 'sky'
  return 'neutral'
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtFull(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await api.getActivity({ limit: 500 })
      setLogs(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity feed')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const entityOptions = useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => l.entity && set.add(l.entity))
    return ['all', ...Array.from(set).sort()]
  }, [logs])

  const actionOptions = useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => l.action && set.add(l.action))
    return ['all', ...Array.from(set).sort()]
  }, [logs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs
      .filter((l) => (entityFilter === 'all' ? true : l.entity === entityFilter))
      .filter((l) => (actionFilter === 'all' ? true : l.action === actionFilter))
      .filter((l) => {
        if (!q) return true
        return (
          l.action.toLowerCase().includes(q) ||
          l.entity.toLowerCase().includes(q) ||
          (l.entity_id ?? '').toLowerCase().includes(q) ||
          JSON.stringify(l.detail ?? {}).toLowerCase().includes(q)
        )
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [logs, entityFilter, actionFilter, search])

  const grouped = useMemo(() => {
    const groups: { key: string; items: ActivityLog[] }[] = []
    for (const item of filtered) {
      const key = dayKey(item.created_at)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.items.push(item)
      else groups.push({ key, items: [item] })
    }
    return groups
  }, [filtered])

  const stats = useMemo(() => {
    const now = Date.now()
    const last24 = logs.filter((l) => now - new Date(l.created_at).getTime() < 86400000).length
    const entities = new Set(logs.map((l) => l.entity)).size
    return { total: logs.length, last24, entities }
  }, [logs])

  if (loading) return <FullPageSpinner label="Loading activity feed..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity</h1>
          <p className="mt-1 text-sm text-slate-400">
            Audit trail of every change across your promotions, data, and analysis.
          </p>
        </div>
        <Button variant="secondary" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? <Spinner className="mr-2" /> : null}
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total events" value={stats.total} />
        <Stat label="Last 24 hours" value={stats.last24} tone={stats.last24 > 0 ? 'positive' : 'default'} />
        <Stat label="Entity types touched" value={stats.entities} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {entityOptions.map((o) => (
                <option key={o} value={o}>
                  {o === 'all' ? 'All entities' : o}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {actionOptions.map((o) => (
                <option key={o} value={o}>
                  {o === 'all' ? 'All actions' : o}
                </option>
              ))}
            </select>
            {(entityFilter !== 'all' || actionFilter !== 'all' || search) && (
              <button
                onClick={() => {
                  setEntityFilter('all')
                  setActionFilter('all')
                  setSearch('')
                }}
                className="text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, entity, id, detail..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none lg:w-80"
          />
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={logs.length === 0 ? 'No activity yet' : 'No events match your filters'}
              description={
                logs.length === 0
                  ? 'As you create promos, ingest data, and run analyses, every change will be logged here.'
                  : 'Try a different entity, action, or clear your search.'
              }
            />
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.key}>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.key}
                  </div>
                  <ol className="relative space-y-3 border-l border-slate-800 pl-5">
                    {group.items.map((l) => (
                      <li key={l.id} className="relative">
                        <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-fuchsia-500" />
                        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={actionTone(l.action)}>{l.action}</Badge>
                            <Badge tone={entityTone(l.entity)}>{l.entity}</Badge>
                            {l.entity_id && (
                              <span className="font-mono text-[11px] text-slate-500">
                                {l.entity_id.slice(0, 8)}
                              </span>
                            )}
                            <span className="ml-auto text-xs text-slate-500" title={fmtFull(l.created_at)}>
                              {relativeTime(l.created_at)}
                            </span>
                          </div>
                          {l.detail && Object.keys(l.detail).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                              {Object.entries(l.detail)
                                .slice(0, 6)
                                .map(([k, v]) => (
                                  <span key={k}>
                                    <span className="text-slate-500">{k}:</span>{' '}
                                    <span className="text-slate-300">
                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                    </span>
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
