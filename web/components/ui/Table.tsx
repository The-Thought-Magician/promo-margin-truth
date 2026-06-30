import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className={`w-full text-sm ${className}`}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-900/80 text-slate-400">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-800">{children}</tbody>
}

export function TR({ children, className = '', ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`hover:bg-slate-900/40 ${className}`} {...props}>{children}</tr>
}

export function TH({ children, className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`px-4 py-3 text-left font-semibold uppercase tracking-wide text-xs ${className}`} {...props}>
      {children}
    </th>
  )
}

export function TD({ children, className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 text-slate-200 ${className}`} {...props}>{children}</td>
}

export default Table
