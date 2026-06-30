'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Promo {
  id: string
  name: string
  status: string
  promo_type: string
  discount_depth_pct: number
  campaign_tag: string | null
  start_at: string
  end_at: string
}

interface ChannelStat {
  id: string
  promo_id: string
  channel: string
  revenue_cents: number
  incremental_contribution_cents: number
  mix_pct: number
  computed_at: string
}

const fmtMoney = (cents: number) => {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
const fmtPct = (v: number) => `${((v ?? 0) * (Math.abs(v) <= 1 ? 100 : 1)).toFixed(1)}%`

const CHANNEL_TONE: Record<string, string> = {
  email: 'bg-fuchsia-500',
  paid: 'bg-sky-500',
  organic: 'bg-emerald-500',
  social: 'bg-amber-500',
  direct: 'bg-violet-500',
  affiliate: 'bg-rose-500',
}
const toneFor = (ch: string) => CHANNEL_TONE[ch.toLowerCase()] ?? 'bg-slate-500'

export default function ChannelsPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [stats, setStats] = useState<ChannelStat[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(false)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const p: Promo[] = await api.getPromos()
        if (!alive) return
        setPromos(p ?? [])
        if (p && p.length) setSelectedId(p[0].id)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load promos')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadStats = useCallback(async (promoId: string) => {
    if (!promoId) return
    setStatsLoading(true)
    setStatsError(null)
    try {
      const s: ChannelStat[] = await api.getChannelStats(promoId)
      setStats(s ?? [])
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Failed to load channel stats')
      setStats([])
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadStats(selectedId)
  }, [selectedId, loadStats])

  const compute = async () => {
    if (!selectedId) return
    setComputing(true)
    setStatsError(null)
    try {
      const res = await api.computeChannelStats(selectedId)
      const next: ChannelStat[] = res?.stats ?? res ?? []
      setStats(Array.isArray(next) ? next : [])
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Failed to compute channel stats')
    } finally {
      setComputing(false)
    }
  }

  const filteredPromos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return promos
    return promos.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.campaign_tag ?? '').toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q),
    )
  }, [promos, search])

  const selected = promos.find((p) => p.id === selectedId)

  const totals = useMemo(() => {
    const rev = stats.reduce((s, c) => s + (c.revenue_cents ?? 0), 0)
    const contrib = stats.reduce((s, c) => s + (c.incremental_contribution_cents ?? 0), 0)
    return { rev, contrib, channels: stats.length }
  }, [stats])

  const maxRev = useMemo(() => Math.max(1, ...stats.map((s) => Math.abs(s.revenue_cents ?? 0))), [stats])
  const sortedStats = useMemo(
    () => [...stats].sort((a, b) => (b.revenue_cents ?? 0) - (a.revenue_cents ?? 0)),
    [stats],
  )

  if (loading) return <FullPageSpinner label="Loading promos..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Channel Attribution</h1>
          <p className="mt-1 text-sm text-slate-400">
            Overlay revenue and incremental contribution by channel for each promotion.
          </p>
        </div>
        <Button onClick={compute} disabled={!selectedId || computing}>
          {computing ? <Spinner className="mr-2" /> : null}
          {computing ? 'Computing...' : 'Recompute channel breakdown'}
        </Button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!error && promos.length === 0 ? (
        <EmptyState
          title="No promotions yet"
          description="Create a promotion and ingest order data to see channel attribution."
          icon="📡"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Promo picker */}
          <Card className="self-start">
            <CardHeader>
              <div className="text-sm font-semibold text-white">Promotions</div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, tag, status..."
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </CardHeader>
            <CardBody className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
              {filteredPromos.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">No matching promotions.</p>
              ) : (
                filteredPromos.map((p) => {
                  const active = p.id === selectedId
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-fuchsia-950/50 ring-1 ring-fuchsia-700' : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{p.name}</span>
                        <Badge tone={p.status === 'active' ? 'green' : p.status === 'analyzed' ? 'fuchsia' : 'neutral'}>
                          {p.status}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {p.campaign_tag ? `#${p.campaign_tag}` : p.promo_type} · {fmtPct(p.discount_depth_pct)} off
                      </div>
                    </button>
                  )
                })
              )}
            </CardBody>
          </Card>

          {/* Detail */}
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Tracked Channels" value={totals.channels} />
              <Stat label="Attributed Revenue" value={fmtMoney(totals.rev)} />
              <Stat
                label="Incremental Contribution"
                value={fmtMoney(totals.contrib)}
                tone={totals.contrib < 0 ? 'negative' : 'positive'}
              />
            </div>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {selected ? selected.name : 'Channel mix'}
                  </div>
                  <div className="text-xs text-slate-500">Revenue mix overlay</div>
                </div>
                {statsLoading && <Spinner />}
              </CardHeader>
              <CardBody>
                {statsError && (
                  <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
                    {statsError}
                  </div>
                )}
                {!statsLoading && stats.length === 0 ? (
                  <EmptyState
                    title="No channel breakdown yet"
                    description="Run the channel computation to attribute this promo's revenue across channels."
                    icon="🧭"
                    action={
                      <Button onClick={compute} disabled={computing}>
                        {computing ? 'Computing...' : 'Compute now'}
                      </Button>
                    }
                  />
                ) : (
                  <>
                    {/* Stacked mix bar */}
                    <div className="mb-6">
                      <div className="flex h-6 w-full overflow-hidden rounded-full bg-slate-800">
                        {sortedStats.map((s) => {
                          const pct = Math.abs(s.mix_pct ?? 0) <= 1 ? (s.mix_pct ?? 0) * 100 : s.mix_pct ?? 0
                          return (
                            <div
                              key={s.id || s.channel}
                              className={toneFor(s.channel)}
                              style={{ width: `${Math.max(0, pct)}%` }}
                              title={`${s.channel}: ${pct.toFixed(1)}%`}
                            />
                          )
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                        {sortedStats.map((s) => (
                          <div key={(s.id || s.channel) + '-leg'} className="flex items-center gap-2 text-xs text-slate-400">
                            <span className={`h-2.5 w-2.5 rounded-sm ${toneFor(s.channel)}`} />
                            <span className="capitalize text-slate-300">{s.channel}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Per-channel revenue bars */}
                    <Table>
                      <THead>
                        <TR>
                          <TH>Channel</TH>
                          <TH className="text-right">Revenue</TH>
                          <TH>Revenue overlay</TH>
                          <TH className="text-right">Mix</TH>
                          <TH className="text-right">Incr. Contribution</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {sortedStats.map((s) => {
                          const pct = Math.abs(s.mix_pct ?? 0) <= 1 ? (s.mix_pct ?? 0) * 100 : s.mix_pct ?? 0
                          const w = (Math.abs(s.revenue_cents ?? 0) / maxRev) * 100
                          return (
                            <TR key={s.id || s.channel}>
                              <TD>
                                <span className="flex items-center gap-2">
                                  <span className={`h-2.5 w-2.5 rounded-sm ${toneFor(s.channel)}`} />
                                  <span className="font-medium capitalize text-slate-100">{s.channel}</span>
                                </span>
                              </TD>
                              <TD className="text-right tabular-nums">{fmtMoney(s.revenue_cents)}</TD>
                              <TD className="w-48">
                                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                                  <div className={`h-full ${toneFor(s.channel)}`} style={{ width: `${w}%` }} />
                                </div>
                              </TD>
                              <TD className="text-right tabular-nums text-slate-400">{pct.toFixed(1)}%</TD>
                              <TD
                                className={`text-right tabular-nums ${
                                  (s.incremental_contribution_cents ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                                }`}
                              >
                                {fmtMoney(s.incremental_contribution_cents)}
                              </TD>
                            </TR>
                          )
                        })}
                      </TBody>
                    </Table>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
