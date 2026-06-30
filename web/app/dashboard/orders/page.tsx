'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface OrderLine {
  id: string
  order_id: string
  sku_code: string
  qty: number
  unit_price_cents: number
  discount_amount_cents: number
  cogs_unit_cents: number
  customer_id: string | null
  order_ts: string | null
  campaign_tag: string | null
  channel: string | null
  is_first_order: boolean | null
  promo_id: string | null
}

interface OrdersSummary {
  count: number
  gross: number
  discount: number
  units: number
}

interface Promo {
  id: string
  name: string
  campaign_tag: string | null
  status: string | null
}

const money = (cents: number | null | undefined) => {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString()

const fmtDate = (ts: string | null | undefined) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderLine[]>([])
  const [summary, setSummary] = useState<OrdersSummary | null>(null)
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [promoId, setPromoId] = useState('')
  const [skuCode, setSkuCode] = useState('')
  const [limit, setLimit] = useState(200)
  const [search, setSearch] = useState('')

  const buildFilters = useCallback(() => {
    const f: Record<string, string | number> = { limit }
    if (promoId) f.promo_id = promoId
    if (skuCode.trim()) f.sku_code = skuCode.trim()
    return f
  }, [promoId, skuCode, limit])

  const load = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const f = buildFilters()
        const [o, s] = await Promise.all([api.getOrders(f), api.getOrdersSummary(f)])
        setOrders(Array.isArray(o) ? o : [])
        setSummary(s?.summary ?? s ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load order lines')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [buildFilters],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const f = { limit }
        const [o, s, p] = await Promise.all([api.getOrders(f), api.getOrdersSummary(f), api.getPromos()])
        if (cancelled) return
        setOrders(Array.isArray(o) ? o : [])
        setSummary(s?.summary ?? s ?? null)
        setPromos(Array.isArray(p) ? p : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load order lines')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const promoName = useCallback(
    (id: string | null) => (id ? promos.find((p) => p.id === id)?.name ?? id.slice(0, 8) : null),
    [promos],
  )

  // client-side free-text search over the loaded rows
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        o.order_id?.toLowerCase().includes(q) ||
        o.sku_code?.toLowerCase().includes(q) ||
        (o.customer_id ?? '').toLowerCase().includes(q) ||
        (o.channel ?? '').toLowerCase().includes(q) ||
        (o.campaign_tag ?? '').toLowerCase().includes(q),
    )
  }, [orders, search])

  // derived net / margin for displayed rows
  const derived = useMemo(() => {
    let net = 0
    let cogs = 0
    for (const o of visible) {
      const gross = (o.unit_price_cents ?? 0) * (o.qty ?? 0)
      net += gross - (o.discount_amount_cents ?? 0)
      cogs += (o.cogs_unit_cents ?? 0) * (o.qty ?? 0)
    }
    const contribution = net - cogs
    const margin = net > 0 ? (contribution / net) * 100 : 0
    return { net, cogs, contribution, margin }
  }, [visible])

  const channels = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of visible) {
      const c = o.channel || 'unknown'
      map.set(c, (map.get(c) ?? 0) + (o.unit_price_cents ?? 0) * (o.qty ?? 0) - (o.discount_amount_cents ?? 0))
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [visible])

  const channelMax = channels.reduce((m, [, v]) => Math.max(m, v), 0)

  const resetFilters = () => {
    setPromoId('')
    setSkuCode('')
    setSearch('')
    setLimit(200)
  }

  const hasActiveFilter = promoId || skuCode.trim() || search.trim() || limit !== 200

  if (loading) return <FullPageSpinner label="Loading order lines..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Order-Line Explorer</h1>
          <p className="mt-1 text-sm text-slate-400">
            Raw ingested order lines with discount, COGS and channel detail — the ground truth behind every margin.
          </p>
        </div>
        <Button variant="secondary" onClick={() => load(false)} disabled={refreshing}>
          {refreshing ? <Spinner className="mr-2" /> : null}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {/* Summary stats from server-side aggregate (respects promo/sku filters) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Order Lines" value={num(summary?.count)} hint="matching server filters" />
        <Stat label="Gross Revenue" value={money(summary?.gross)} />
        <Stat label="Total Discount" value={money(summary?.discount)} tone="negative" />
        <Stat label="Units Sold" value={num(summary?.units)} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Promo</label>
            <select
              value={promoId}
              onChange={(e) => setPromoId(e.target.value)}
              className="min-w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="">All promos</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">SKU code</label>
            <input
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              placeholder="exact SKU"
              className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Limit</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Search rows</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="order / sku / customer / channel"
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => load(false)} disabled={refreshing}>
              Apply
            </Button>
            {hasActiveFilter ? (
              <Button variant="ghost" onClick={resetFilters}>
                Clear
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          {/* derived stats for the rows currently shown */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Shown net rev</div>
              <div className="text-sm font-semibold text-slate-100">{money(derived.net)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Shown COGS</div>
              <div className="text-sm font-semibold text-slate-100">{money(derived.cogs)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Contribution</div>
              <div className={`text-sm font-semibold ${derived.contribution < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {money(derived.contribution)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Margin %</div>
              <div className={`text-sm font-semibold ${derived.margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {derived.margin.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* channel mix bar chart (pure SVG/divs) */}
          {channels.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                Net revenue by channel (shown rows)
              </div>
              <div className="space-y-2">
                {channels.map(([ch, v]) => (
                  <div key={ch} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs text-slate-400">{ch}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400"
                        style={{ width: `${channelMax > 0 ? Math.max(2, (v / channelMax) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs text-slate-300">{money(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              title="No order lines"
              description={
                hasActiveFilter
                  ? 'No rows match the current filters. Try clearing them or ingesting data.'
                  : 'Ingest order data or seed the sample brand from the Ingestion page to populate this explorer.'
              }
            />
          ) : (
            <>
              <div className="text-xs text-slate-500">
                Showing {visible.length.toLocaleString()} of {orders.length.toLocaleString()} loaded line
                {orders.length === 1 ? '' : 's'}
                {search.trim() ? ' (filtered)' : ''}.
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH>Order</TH>
                    <TH>SKU</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Unit</TH>
                    <TH className="text-right">Discount</TH>
                    <TH className="text-right">COGS/u</TH>
                    <TH>Channel</TH>
                    <TH>Promo</TH>
                    <TH>Customer</TH>
                    <TH>When</TH>
                  </TR>
                </THead>
                <TBody>
                  {visible.map((o) => {
                    const gross = (o.unit_price_cents ?? 0) * (o.qty ?? 0)
                    const net = gross - (o.discount_amount_cents ?? 0)
                    const cogs = (o.cogs_unit_cents ?? 0) * (o.qty ?? 0)
                    const losing = net - cogs < 0
                    return (
                      <TR key={o.id}>
                        <TD className="font-mono text-xs">{o.order_id}</TD>
                        <TD className="font-mono text-xs">{o.sku_code}</TD>
                        <TD className="text-right tabular-nums">{num(o.qty)}</TD>
                        <TD className="text-right tabular-nums">{money(o.unit_price_cents)}</TD>
                        <TD className="text-right tabular-nums text-rose-300">
                          {o.discount_amount_cents ? money(o.discount_amount_cents) : '—'}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {o.cogs_unit_cents ? (
                            money(o.cogs_unit_cents)
                          ) : (
                            <Badge tone="amber">no COGS</Badge>
                          )}
                        </TD>
                        <TD>{o.channel ? <Badge tone="sky">{o.channel}</Badge> : <span className="text-slate-600">—</span>}</TD>
                        <TD>
                          {o.promo_id ? (
                            <span className="text-fuchsia-300">{promoName(o.promo_id)}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TD>
                        <TD className="text-xs text-slate-400">
                          {o.customer_id ? (
                            <span className="flex items-center gap-1">
                              {o.customer_id.slice(0, 10)}
                              {o.is_first_order ? <Badge tone="green">new</Badge> : null}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TD>
                        <TD className="text-xs">
                          {fmtDate(o.order_ts)}
                          {losing ? <span className="ml-2 text-rose-400" title="line loses money">●</span> : null}
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
  )
}
