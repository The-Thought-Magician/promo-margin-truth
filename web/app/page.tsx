import Link from 'next/link'

const FEATURES = [
  {
    title: 'Per-Promo P&L',
    body: 'Gross revenue down to net contribution margin in dollars and percent, with a full waterfall and realized-vs-list margin erosion.',
  },
  {
    title: 'Incrementality Estimation',
    body: 'Pre-period, control-segment, and blended baselines. Incremental units and revenue, incrementality ratio, and a deterministic confidence band.',
  },
  {
    title: 'Cannibalization Detection',
    body: 'Pull-forward from the future, cross-SKU theft, and discount-of-the-already-converting, rolled into a dollar adjustment on contribution.',
  },
  {
    title: 'Discount-Depth Elasticity',
    body: 'Fit response of incremental units to discount depth and find the margin-optimal level. Project net contribution at any depth.',
  },
  {
    title: 'New-vs-Existing Split',
    body: 'First-order vs repeat mix, existing-customer subsidy, and contribution split between net-new and loyal customers.',
  },
  {
    title: 'Money-Losing Kill List',
    body: 'Automatic flagging of negative-contribution promos, severity ranked by dollars destroyed, with recurring-loser detection.',
  },
  {
    title: 'CFO Retrospective',
    body: 'One-click per-promo and period teardowns with a dollar-recovery summary. Exportable, print-friendly, executive-ready.',
  },
  {
    title: 'Promo Calendar',
    body: 'Planned, active, and past promos with overlap warnings and projected-vs-realized contribution across the cycle.',
  },
  {
    title: 'SKU & COGS Management',
    body: 'Unit COGS, list prices, effective-dated overrides, bulk import, and missing-COGS detection that blocks inaccurate P&L.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-black tracking-tight">
          <span className="text-white">Promo</span><span className="text-fuchsia-500">MarginTruth</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-4 py-2 rounded-lg">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-fuchsia-800 bg-fuchsia-950/50 px-3 py-1 text-xs font-medium text-fuchsia-300">
          Promo profitability analytics for DTC brands
        </span>
        <h1 className="mt-6 text-4xl sm:text-6xl font-black tracking-tight leading-tight">
          Which promotions <span className="text-fuchsia-500">actually</span> made money?
        </h1>
        <p className="mt-6 mx-auto max-w-2xl text-lg text-slate-400">
          Top-line revenue during a sale lies. PromoMarginTruth computes a defensible per-promo P&amp;L down to net
          contribution after discount, incrementality, and cannibalization, then names the money-losing promos to kill.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-6 py-3 rounded-lg font-semibold">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="border border-slate-700 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">Every feature free for signed-in users. Load the sample BFCM teardown in one click.</p>
      </section>

      <section className="border-y border-slate-800 bg-slate-900/30 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center">Revenue spikes hide margin destruction</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3 text-left">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="text-fuchsia-400 font-semibold">Discount erosion</div>
              <p className="mt-2 text-sm text-slate-400">A 30%-off sitewide event posts record revenue while burning contribution margin on customers who would have paid full price.</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="text-fuchsia-400 font-semibold">Low incrementality</div>
              <p className="mt-2 text-sm text-slate-400">Sales that would have happened anyway get a discount they never needed. Nobody computes the baseline.</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="text-fuchsia-400 font-semibold">Cannibalization</div>
              <p className="mt-2 text-sm text-slate-400">Full-price demand pulled forward or stolen from adjacent SKUs. Spreadsheets cannot sustain this analysis.</p>
            </div>
          </div>
          <p className="mt-8 text-center text-slate-400">
            So growth teams rerun the same losing promos every cycle, and the CFO watches blended margin compress with
            no specific promo to cut.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold text-center">The per-promo truth engine</h2>
        <p className="mt-2 text-center text-slate-400">Deterministic analytics over uploaded, connected, or generated order data.</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 hover:border-fuchsia-800/60 transition-colors">
              <h3 className="text-lg font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800 px-6 py-20 text-center">
        <h2 className="text-3xl font-bold">Stop running promos on faith</h2>
        <p className="mt-4 mx-auto max-w-xl text-slate-400">
          Get a CFO-ready retrospective and a dollar-recovery story before your next margin review.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-6 py-3 rounded-lg font-semibold">
            Get started free
          </Link>
          <Link href="/pricing" className="border border-slate-700 hover:bg-slate-800 text-slate-200 px-6 py-3 rounded-lg font-semibold">
            See pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-slate-600">
        <p>PromoMarginTruth</p>
      </footer>
    </main>
  )
}
