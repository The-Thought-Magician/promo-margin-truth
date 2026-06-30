export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-fuchsia-500 ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function FullPageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-400">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export default Spinner
