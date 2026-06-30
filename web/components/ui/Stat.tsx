import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'positive' | 'negative'
  className?: string
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  const valueColor =
    tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-white'
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${valueColor}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export default Stat
