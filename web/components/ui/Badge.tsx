import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'fuchsia' | 'green' | 'red' | 'amber' | 'sky'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  fuchsia: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-800',
  green: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
  red: 'bg-rose-950/60 text-rose-300 border-rose-800',
  amber: 'bg-amber-950/60 text-amber-300 border-amber-800',
  sky: 'bg-sky-950/60 text-sky-300 border-sky-800',
}

export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
