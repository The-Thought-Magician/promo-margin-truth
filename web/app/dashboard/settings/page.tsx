'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Workspace {
  id: string
  user_id: string
  name: string
  currency: string
  platform_fee_pct: number
  pre_period_days: number
  pull_forward_days: number
  flag_min_contribution_cents: number
  flag_min_margin_pct: number
  created_at: string
  updated_at: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id: string
  user_id: string
  plan_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  current_period_end: string | null
  created_at: string
  updated_at: string
}

interface BillingState {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled: boolean
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']

function money(cents: number, currency = 'USD'): string {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency })
}

interface FormState {
  name: string
  currency: string
  platform_fee_pct: string
  pre_period_days: string
  pull_forward_days: string
  flag_min_contribution_dollars: string
  flag_min_margin_pct: string
}

function toForm(w: Workspace): FormState {
  return {
    name: w.name ?? '',
    currency: w.currency ?? 'USD',
    platform_fee_pct: String(w.platform_fee_pct ?? 0),
    pre_period_days: String(w.pre_period_days ?? 0),
    pull_forward_days: String(w.pull_forward_days ?? 0),
    flag_min_contribution_dollars: String((w.flag_min_contribution_cents ?? 0) / 100),
    flag_min_margin_pct: String(w.flag_min_margin_pct ?? 0),
  }
}

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [billing, setBilling] = useState<BillingState | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ws, bill] = await Promise.all([
        api.getWorkspace(),
        api.getBillingPlan().catch(() => null),
      ])
      const w: Workspace = ws?.workspace ?? ws
      setWorkspace(w)
      setForm(toForm(w))
      if (bill) {
        setBilling({
          subscription: bill.subscription ?? null,
          plan: bill.plan ?? null,
          stripeEnabled: Boolean(bill.stripeEnabled),
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dirty = useMemo(() => {
    if (!workspace || !form) return false
    const original = toForm(workspace)
    return (Object.keys(original) as (keyof FormState)[]).some((k) => original[k] !== form[k])
  }, [workspace, form])

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setNotice(null)
  }

  function validate(f: FormState): string | null {
    if (!f.name.trim()) return 'Workspace name is required.'
    const num = (v: string) => Number(v)
    const fee = num(f.platform_fee_pct)
    if (Number.isNaN(fee) || fee < 0 || fee > 100) return 'Platform fee must be between 0 and 100%.'
    const pre = num(f.pre_period_days)
    if (Number.isNaN(pre) || pre < 0 || !Number.isInteger(pre)) return 'Pre-period days must be a non-negative whole number.'
    const pull = num(f.pull_forward_days)
    if (Number.isNaN(pull) || pull < 0 || !Number.isInteger(pull)) return 'Pull-forward days must be a non-negative whole number.'
    const contrib = num(f.flag_min_contribution_dollars)
    if (Number.isNaN(contrib)) return 'Minimum contribution threshold must be a number.'
    const margin = num(f.flag_min_margin_pct)
    if (Number.isNaN(margin) || margin < -100 || margin > 100) return 'Minimum margin threshold must be between -100 and 100%.'
    return null
  }

  async function save() {
    if (!form) return
    const validationError = validate(form)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = {
        name: form.name.trim(),
        currency: form.currency,
        platform_fee_pct: Number(form.platform_fee_pct),
        pre_period_days: Math.round(Number(form.pre_period_days)),
        pull_forward_days: Math.round(Number(form.pull_forward_days)),
        flag_min_contribution_cents: Math.round(Number(form.flag_min_contribution_dollars) * 100),
        flag_min_margin_pct: Number(form.flag_min_margin_pct),
      }
      const res = await api.updateWorkspace(payload)
      const w: Workspace = res?.workspace ?? res
      setWorkspace(w)
      setForm(toForm(w))
      setNotice('Settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (workspace) setForm(toForm(workspace))
    setError(null)
    setNotice(null)
  }

  async function upgrade() {
    setCheckoutBusy(true)
    setBillingError(null)
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
      else setBillingError('Checkout is not available right now.')
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to start checkout')
    } finally {
      setCheckoutBusy(false)
    }
  }

  async function manageBilling() {
    setPortalBusy(true)
    setBillingError(null)
    try {
      const res = await api.openBillingPortal()
      if (res?.url) window.location.href = res.url
      else setBillingError('Billing portal is not available right now.')
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : 'Failed to open billing portal')
    } finally {
      setPortalBusy(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading settings..." />

  if (error && !workspace) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <EmptyState
          title="Could not load settings"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const isPro = (billing?.subscription?.plan_id ?? billing?.plan?.id) === 'pro'
  const subStatus = billing?.subscription?.status
  const hasStripeCustomer = Boolean(billing?.subscription?.stripe_customer_id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure margin assumptions, analysis windows, kill-list thresholds, and your billing plan.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {error && workspace && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {form && (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Workspace</h2>
              <p className="mt-0.5 text-xs text-slate-400">Name and reporting currency.</p>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Workspace name">
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                />
              </Field>
              <Field label="Reporting currency">
                <select
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Margin assumptions</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Fees deducted from net revenue before contribution is computed.
              </p>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Platform fee" hint="Marketplace / processing fee as a % of net revenue.">
                <Suffixed suffix="%">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={form.platform_fee_pct}
                    onChange={(e) => set('platform_fee_pct', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-8 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  />
                </Suffixed>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Analysis windows</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Baselines for incrementality and cannibalization computations.
              </p>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Pre-period days" hint="Baseline window before a promo starts.">
                <Suffixed suffix="days">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.pre_period_days}
                    onChange={(e) => set('pre_period_days', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-12 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  />
                </Suffixed>
              </Field>
              <Field label="Pull-forward days" hint="Window after a promo to detect demand pulled forward.">
                <Suffixed suffix="days">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.pull_forward_days}
                    onChange={(e) => set('pull_forward_days', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-12 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  />
                </Suffixed>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Kill-list thresholds</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                A promo is flagged when its contribution or margin falls below these.
              </p>
            </CardHeader>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Min contribution" hint="Flag promos contributing less than this.">
                <Prefixed prefix="$">
                  <input
                    type="number"
                    step="1"
                    value={form.flag_min_contribution_dollars}
                    onChange={(e) => set('flag_min_contribution_dollars', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pl-7 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  />
                </Prefixed>
              </Field>
              <Field label="Min realized margin" hint="Flag promos below this realized margin.">
                <Suffixed suffix="%">
                  <input
                    type="number"
                    step="0.1"
                    value={form.flag_min_margin_pct}
                    onChange={(e) => set('flag_min_margin_pct', e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-8 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  />
                </Suffixed>
              </Field>
            </CardBody>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Spinner className="mr-2" /> : null}
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Billing</h2>
            <p className="mt-0.5 text-xs text-slate-400">Manage your subscription plan.</p>
          </div>
          {billing && (
            <Badge tone={isPro ? 'fuchsia' : 'neutral'}>{(billing.plan?.name ?? billing.subscription?.plan_id ?? 'Free')}</Badge>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {billingError && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              {billingError}
            </div>
          )}
          {!billing ? (
            <EmptyState title="Billing unavailable" description="Could not load your billing plan." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Current plan</div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {billing.plan?.name ?? (isPro ? 'Pro' : 'Free')}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-400">
                    {billing.plan ? `${money(billing.plan.price_cents)}/mo` : 'Free tier'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Subscription status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      tone={
                        subStatus === 'active'
                          ? 'green'
                          : subStatus === 'past_due' || subStatus === 'canceled'
                            ? 'red'
                            : 'neutral'
                      }
                    >
                      {subStatus ?? 'none'}
                    </Badge>
                  </div>
                  {billing.subscription?.current_period_end && (
                    <div className="mt-1 text-xs text-slate-500">
                      Renews{' '}
                      {new Date(billing.subscription.current_period_end).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  )}
                </div>
              </div>

              {!billing.stripeEnabled && (
                <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                  Stripe is not configured on this deployment. Billing actions are unavailable until
                  Stripe keys are set.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!isPro ? (
                  <Button onClick={upgrade} disabled={checkoutBusy || !billing.stripeEnabled}>
                    {checkoutBusy ? <Spinner className="mr-2" /> : null}
                    {checkoutBusy ? 'Starting...' : 'Upgrade to Pro'}
                  </Button>
                ) : (
                  <Badge tone="green">You are on Pro</Badge>
                )}
                {(isPro || hasStripeCustomer) && (
                  <Button
                    variant="secondary"
                    onClick={manageBilling}
                    disabled={portalBusy || !billing.stripeEnabled}
                  >
                    {portalBusy ? <Spinner className="mr-2" /> : null}
                    {portalBusy ? 'Opening...' : 'Manage billing'}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function Suffixed({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
        {suffix}
      </span>
    </div>
  )
}

function Prefixed({ prefix, children }: { prefix: string; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        {prefix}
      </span>
      {children}
    </div>
  )
}
