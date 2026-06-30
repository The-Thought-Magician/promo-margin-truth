'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignUp() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signUp.email({ name: fd.get('name') as string, email: fd.get('email') as string, password: fd.get('password') as string })
    setLoading(false)
    if (error) { setError(error.message ?? 'Failed'); return }
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-black tracking-tight">
            <span className="text-white">Promo</span><span className="text-fuchsia-500">MarginTruth</span>
          </Link>
          <h1 className="text-2xl font-bold mt-4">Create your account</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-slate-900 rounded-xl border border-slate-800 p-8 space-y-4">
          {error && <div className="bg-rose-950/40 border border-rose-800 text-rose-300 rounded-lg p-3 text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
            <input name="name" type="text" required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500" placeholder="Your name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
            <input name="email" type="email" required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500" placeholder="you@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <input name="password" type="password" required minLength={8} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500" />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
          <p className="text-center text-slate-400 text-sm">
            Already have an account? <Link href="/auth/sign-in" className="text-fuchsia-400 hover:text-fuchsia-300">Sign in</Link>
          </p>
        </form>
      </div>
    </main>
  )
}
