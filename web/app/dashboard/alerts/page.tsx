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

interface PromoAlert {
  id: string
  user_id: string
  promo_id: string | null
  severity: string
  dollars_destroyed_cents: number
  recommendation: string | null
  is_recurring: boolean
  status: string
  detail: Record<string, unknown> | null
  created_at: string
}

const STATUS_TABS = ['all', 'open', 'acknowledged', 'snoozed', 'resolved'] as const
type StatusTab = (typeof STATUS_TABS)[number]

function money(cents: number): string {
  const dollars = (cents ?? 0) / 100
  const abs = Math.abs(dollars)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${dollars < 0 ? '-' : ''}$${formatted}`
}

function severityTone(sev: string): 'red' | 'amber' | 'sky' | 'neutral' {
  switch (sev) {
    case 'critical':
      return 'red'
    case 'high':
      return 'red'
    case 'medium':
      return 'amber'
    case 'low':
      return 'sky'
    default:
      return 'neutral'
  }
}

function statusTone(status: string): 'green' | 'amber' | 'fuchsia' | 'neutral' {
  switch (status) {
    case 'resolved':
      return 'green'
    case 'snoozed':
      return 'amber'
    case 'acknowledged':
      return 'fuchsia'
    default:
      return 'neutral'
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PromoAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getAlerts()
      setAlerts(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the kill list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function runScan() {
    setScanning(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.scanAlerts()
      const created = res?.created ?? (Array.isArray(res?.alerts) ? res.alerts.length : 0)
      setNotice(`Scan complete. ${created} alert${created === 1 ? '' : 's'} flagged.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function act(id: string, fn: (id: string) => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts
      .filter((a) => (tab === 'all' ? true : a.status === tab))
      .filter((a) => {
        if (!q) return true
        return (
          (a.recommendation ?? '').toLowerCase().includes(q) ||
          (a.promo_id ?? '').toLowerCase().includes(q) ||
          a.severity.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => b.dollars_destroyed_cents - a.dollars_destroyed_cents)
  }, [alerts, tab, search])

  const totals = useMemo(() => {
    const open = alerts.filter((a) => a.status === 'open')
    const destroyed = open.reduce((s, a) => s + (a.dollars_destroyed_cents ?? 0), 0)
    const recurring = alerts.filter((a) => a.is_recurring).length
    const worst = [...alerts].sort((a, b) => b.dollars_destroyed_cents - a.dollars_destroyed_cents)[0]
    return { openCount: open.length, destroyed, recurring, worst }
  }, [alerts])

  const maxDestroyed = useMemo(
    () => Math.max(1, ...filtered.map((a) => a.dollars_destroyed_cents ?? 0)),
    [filtered],
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: alerts.length }
    for (const t of STATUS_TABS) {
      if (t === 'all') continue
      map[t] = alerts.filter((a) => a.status === t).length
    }
    return map
  }, [alerts])

  if (loading) return <FullPageSpinner label="Loading the kill list..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Promo Kill List</h1>
          <p className="mt-1 text-sm text-slate-400">
            Money-losing promotions ranked by the dollars they destroyed. Scan to recompute from the latest P&amp;L.
          </p>
        </div>
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? <Spinner className="mr-2" /> : null}
          {scanning ? 'Scanning...' : 'Run scan'}
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-fuchsia-800 bg-fuchsia-950/40 px-4 py-3 text-sm text-fuchsia-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open alerts" value={totals.openCount} tone={totals.openCount > 0 ? 'negative' : 'default'} />
        <Stat
          label="Dollars destroyed (open)"
          value={money(totals.destroyed)}
          tone={totals.destroyed > 0 ? 'negative' : 'default'}
          hint="Sum across open alerts"
        />
        <Stat label="Recurring offenders" value={totals.recurring} tone={totals.recurring > 0 ? 'negative' : 'default'} />
        <Stat
          label="Worst single promo"
          value={totals.worst ? money(totals.worst.dollars_destroyed_cents) : '$0'}
          tone={totals.worst ? 'negative' : 'default'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  tab === t
                    ? 'bg-fuchsia-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t} <span className="ml-1 text-[10px] opacity-70">{counts[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recommendation, promo, severity..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none sm:w-72"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={alerts.length === 0 ? 'No alerts yet' : 'No alerts match your filter'}
                description={
                  alerts.length === 0
                    ? 'Run a scan to flag promotions that are destroying contribution dollars.'
                    : 'Try a different status tab or clear your search.'
                }
                action={
                  alerts.length === 0 ? (
                    <Button onClick={runScan} disabled={scanning}>
                      {scanning ? 'Scanning...' : 'Run scan'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>Dollars destroyed</TH>
                  <TH>Severity</TH>
                  <TH>Recommendation</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((a, i) => {
                  const pct = Math.round(((a.dollars_destroyed_cents ?? 0) / maxDestroyed) * 100)
                  const isBusy = busyId === a.id
                  return (
                    <TR key={a.id}>
                      <TD className="text-slate-500">{i + 1}</TD>
                      <TD>
                        <div className="font-semibold text-rose-300">{money(a.dollars_destroyed_cents)}</div>
                        <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
                        </div>
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                          {a.is_recurring && <Badge tone="amber">recurring</Badge>}
                        </div>
                      </TD>
                      <TD className="max-w-md">
                        <div className="text-slate-200">{a.recommendation ?? '—'}</div>
                        {a.promo_id && (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">promo {a.promo_id.slice(0, 8)}</div>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-xs"
                            disabled={isBusy || a.status === 'acknowledged'}
                            onClick={() => act(a.id, api.ackAlert)}
                          >
                            Ack
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2.5 py-1 text-xs"
                            disabled={isBusy || a.status === 'snoozed'}
                            onClick={() => act(a.id, api.snoozeAlert)}
                          >
                            Snooze
                          </Button>
                          <Button
                            variant="danger"
                            className="px-2.5 py-1 text-xs"
                            disabled={isBusy || a.status === 'resolved'}
                            onClick={() => act(a.id, api.resolveAlert)}
                          >
                            {isBusy ? <Spinner /> : 'Resolve'}
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
    </div>
  )
}
