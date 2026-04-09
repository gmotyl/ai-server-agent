import { useState } from 'react'
import { api, setApiToken } from '../api'
import { useStore } from '../store'
import type { Status } from '../types'

export function Login() {
  const { setToken } = useStore()
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(false)
    setApiToken(input.trim())
    try {
      await api<Status>('GET', '/status')
      setToken(input.trim())
    } catch {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6 relative">
      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(196,248,42,0.04), transparent)' }} />

      <div className="bg-surface border border-brd rounded-[14px] p-8 w-full max-w-[380px] text-center animate-fade-up relative">
        {/* Logo */}
        <div className="mb-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto">
            <rect x="4" y="4" width="40" height="40" rx="8" stroke="currentColor" strokeWidth="2.5" className="text-lime" fill="none" />
            <circle cx="18" cy="20" r="3" className="fill-lime" />
            <circle cx="30" cy="20" r="3" className="fill-lime" />
            <path d="M16 30 Q24 36 32 30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-lime" fill="none" />
            <rect x="20" y="2" width="8" height="6" rx="2" className="fill-surface-2 stroke-lime" strokeWidth="1.5" />
          </svg>
        </div>

        <h1 className="font-display font-extrabold text-[1.6rem] tracking-tight mb-0.5 animate-fade-up"
          style={{ animationDelay: '0.15s' }}>
          ai-server-agent
        </h1>
        <p className="font-mono text-[0.75rem] text-txt-3 uppercase tracking-widest mb-7 animate-fade-up"
          style={{ animationDelay: '0.2s' }}>
          Operations Console
        </p>

        {error && (
          <div className="bg-danger-dim text-danger text-sm px-3 py-2 rounded-lg mb-4 border border-danger/15">
            Invalid token. Try again.
          </div>
        )}

        <div className="text-left mb-5 animate-fade-up" style={{ animationDelay: '0.25s' }}>
          <label htmlFor="token" className="block font-mono text-[0.7rem] text-txt-3 uppercase tracking-widest mb-1.5">
            Access Token
          </label>
          <input
            id="token"
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Enter token"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="w-full px-4 py-2.5 bg-bg border border-brd rounded-lg text-txt font-mono text-[0.9rem]
              transition-all focus:outline-none focus:border-lime focus:ring-3 focus:ring-lime-dim"
          />
        </div>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-lime text-bg
            rounded-lg font-semibold text-[0.85rem] cursor-pointer transition-all
            hover:shadow-[0_0_20px_var(--color-lime-glow)] hover:-translate-y-0.5
            active:translate-y-0 active:opacity-90 disabled:opacity-50 animate-fade-up"
          style={{ animationDelay: '0.3s' }}
        >
          <span>{loading ? 'Authenticating...' : 'Authenticate'}</span>
          {!loading && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
