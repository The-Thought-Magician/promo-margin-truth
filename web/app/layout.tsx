import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PromoMarginTruth',
  description: 'Reveal which promotions actually made money after discount, incrementality, and cannibalization.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
