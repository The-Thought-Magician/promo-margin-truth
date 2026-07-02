'use client'
import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'
import { FullPageSpinner } from '@/components/ui/Spinner'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Data',
    items: [
      { label: 'Ingestion', href: '/dashboard/data' },
      { label: 'Column Mapping', href: '/dashboard/data/map' },
      { label: 'Orders', href: '/dashboard/orders' },
      { label: 'SKUs & COGS', href: '/dashboard/skus' },
    ],
  },
  {
    title: 'Promos',
    items: [
      { label: 'Catalog', href: '/dashboard/promos' },
      { label: 'Calendar', href: '/dashboard/calendar' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Incrementality', href: '/dashboard/incrementality' },
      { label: 'Cannibalization', href: '/dashboard/cannibalization' },
      { label: 'Elasticity', href: '/dashboard/elasticity' },
      { label: 'Scenarios', href: '/dashboard/scenarios' },
      { label: 'Cohorts & Segments', href: '/dashboard/cohorts' },
      { label: 'Channels', href: '/dashboard/channels' },
    ],
  },
  {
    title: 'Truth & Action',
    items: [
      { label: 'Kill List', href: '/dashboard/alerts' },
      { label: 'Retrospective', href: '/dashboard/retrospective' },
      { label: 'Benchmarks', href: '/dashboard/benchmarks' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Activity', href: '/dashboard/activity' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    authClient.getSession().then((s) => {
      if (!mounted) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      setReady(true)
    }).catch(() => router.push('/auth/sign-in'))
    return () => { mounted = false }
  }, [router])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) return <FullPageSpinner />

  const Sidebar = (
    <nav className="flex h-full flex-col gap-7 overflow-y-auto px-5 py-7">
      <Link href="/dashboard" className="px-1 text-xl font-black tracking-tight">
        <span className="text-white">Promo</span>
        <span className="text-fuchsia-400">MarginTruth</span>
      </Link>
      <div className="flex flex-col gap-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
              {section.title}
            </div>
            <div className="flex flex-col gap-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-3.5 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-fuchsia-500 font-semibold text-white shadow-md shadow-fuchsia-950/40'
                        : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-slate-900/40 lg:block">
        <div className="sticky top-0 h-screen">{Sidebar}</div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-slate-800 bg-slate-900">{Sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-slate-400">Workspace</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
