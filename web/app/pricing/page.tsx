'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const FREE_FEATURES = [
  'CSV ingestion + column mapping + sample-data generator',
  'Promo catalog, calendar, and overlap detection',
  'Per-promo P&L waterfall to net contribution',
  'Incrementality (pre-period / control / blended)',
  'Cannibalization + new-vs-existing customer split',
  'Discount-depth elasticity curves + scenario simulator',
  'Money-losing kill list + CFO retrospective export',
  'SKU & COGS management, benchmarks, and reports',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [planName, setPlanName] = useState<string>('Free')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getBillingPlan()
      .then((res) => {
        if (res?.plan?.name) setPlanName(res.plan.name)
        setStripeEnabled(!!res?.stripeEnabled)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const upgrade = async () => {
    setBusy(true)
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
    } catch {
      // billing not configured — stays on page
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-black tracking-tight">
          <span className="text-white">Promo</span><span className="text-fuchsia-500">MarginTruth</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-4 py-2 rounded-lg">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, honest pricing</h1>
        <p className="mt-4 text-slate-400">
          Every feature is free for signed-in users. Billing is wired but optional.
          {loading ? '' : ` Your current plan: ${planName}.`}
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2 text-left">
          <div className="rounded-2xl border border-fuchsia-700/50 bg-slate-900/60 p-8 ring-1 ring-fuchsia-700/30">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">Free</h2>
              <span className="rounded-full border border-fuchsia-800 bg-fuchsia-950/50 px-3 py-1 text-xs font-medium text-fuchsia-300">All features</span>
            </div>
            <div className="mt-4 text-4xl font-black">$0<span className="text-base font-medium text-slate-500">/mo</span></div>
            <p className="mt-2 text-sm text-slate-400">The full per-promo truth engine, no gates.</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-fuchsia-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/auth/sign-up" className="mt-8 block w-full rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 px-4 py-3 text-center font-semibold">
              Start free
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">Optional</span>
            </div>
            <div className="mt-4 text-4xl font-black text-slate-300">Contact</div>
            <p className="mt-2 text-sm text-slate-400">
              Same features today. Pro exists for teams that want managed billing and future premium add-ons.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-400">
              <li className="flex gap-2"><span className="text-slate-500">•</span><span>Everything in Free</span></li>
              <li className="flex gap-2"><span className="text-slate-500">•</span><span>Priority support</span></li>
              <li className="flex gap-2"><span className="text-slate-500">•</span><span>Managed Stripe billing</span></li>
            </ul>
            <button
              onClick={upgrade}
              disabled={!stripeEnabled || busy}
              className="mt-8 block w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-center font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Redirecting...' : stripeEnabled ? 'Upgrade to Pro' : 'Billing not enabled'}
            </button>
            {!stripeEnabled && !loading && (
              <p className="mt-3 text-center text-xs text-slate-500">Billing is not configured on this deployment.</p>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-slate-600">
        <p>PromoMarginTruth</p>
      </footer>
    </main>
  )
}
