'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  user_id: string
  kind: string
  title: string
  body: string | null
  read: boolean
  created_at: string
}

const FILTERS = ['all', 'unread', 'read'] as const
type Filter = (typeof FILTERS)[number]

const KIND_TONE: Record<string, 'fuchsia' | 'green' | 'red' | 'amber' | 'sky' | 'neutral'> = {
  alert: 'red',
  warning: 'amber',
  success: 'green',
  info: 'sky',
  report: 'fuchsia',
  billing: 'fuchsia',
  ingestion: 'amber',
}

function kindTone(kind: string) {
  return KIND_TONE[kind] ?? 'neutral'
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

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getNotifications()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function markRead(id: string) {
    const target = items.find((n) => n.id === id)
    if (target?.read) return
    setBusyId(id)
    setError(null)
    // optimistic
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    try {
      await api.markNotificationRead(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as read')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    if (items.every((n) => n.read)) return
    setMarkingAll(true)
    setError(null)
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all as read')
      await load()
    } finally {
      setMarkingAll(false)
    }
  }

  const kindOptions = useMemo(() => {
    const set = new Set<string>()
    items.forEach((n) => n.kind && set.add(n.kind))
    return ['all', ...Array.from(set).sort()]
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.read : n.read))
      .filter((n) => (kindFilter === 'all' ? true : n.kind === kindFilter))
      .filter((n) => {
        if (!q) return true
        return (
          n.title.toLowerCase().includes(q) ||
          (n.body ?? '').toLowerCase().includes(q) ||
          n.kind.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [items, filter, kindFilter, search])

  const counts = useMemo(() => {
    const unread = items.filter((n) => !n.read).length
    return { total: items.length, unread, read: items.length - unread }
  }, [items])

  if (loading) return <FullPageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Alerts, report completions, and billing events for your workspace.
          </p>
        </div>
        <Button onClick={markAll} disabled={markingAll || counts.unread === 0}>
          {markingAll ? <Spinner className="mr-2" /> : null}
          {markingAll ? 'Marking...' : `Mark all read${counts.unread ? ` (${counts.unread})` : ''}`}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total" value={counts.total} />
        <Stat label="Unread" value={counts.unread} tone={counts.unread > 0 ? 'negative' : 'default'} />
        <Stat label="Read" value={counts.read} tone="positive" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  filter === f ? 'bg-fuchsia-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {f}
                <span className="ml-1 text-[10px] opacity-70">
                  {f === 'all' ? counts.total : f === 'unread' ? counts.unread : counts.read}
                </span>
              </button>
            ))}
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {kindOptions.map((o) => (
                <option key={o} value={o}>
                  {o === 'all' ? 'All kinds' : o}
                </option>
              ))}
            </select>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notifications..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none lg:w-72"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={items.length === 0 ? 'No notifications' : 'Nothing matches your filter'}
                description={
                  items.length === 0
                    ? "You're all caught up. Notifications appear here when alerts fire, reports finish, or billing changes."
                    : 'Try a different filter or clear your search.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {filtered.map((n) => {
                const isBusy = busyId === n.id
                return (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                      n.read ? 'bg-transparent' : 'bg-fuchsia-950/10'
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.read ? 'bg-slate-700' : 'bg-fuchsia-500'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>
                        <span
                          className={`truncate text-sm font-semibold ${
                            n.read ? 'text-slate-300' : 'text-white'
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-slate-500">
                          {relativeTime(n.created_at)}
                        </span>
                      </div>
                      {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                    </div>
                    <div className="shrink-0">
                      {!n.read && (
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                          disabled={isBusy}
                          onClick={() => markRead(n.id)}
                        >
                          {isBusy ? <Spinner /> : 'Mark read'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
