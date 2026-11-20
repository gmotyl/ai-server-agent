import { useEffect, useRef, useState } from 'react'

const PIN_WARNING = 'PIN may not have worked, check the screen'
const COOLDOWN_FALLBACK_MS = 300_000 // matches server SPOCK_PIN_COOLDOWN_MS default
const LOCKOUT_FALLBACK_MS = 60_000 // matches server auth lockout default

type Phase = 'idle' | 'waking' | 'awake' | 'timeout' | 'error'

interface WakeReply {
  status?: string
  message?: string
  error?: string
  elapsedMs?: number
  retryAfterMs?: number
}

const fmt = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))}s`

// The wake token and PIN live in React state only: never in storage, cookies or URL.
export function WakeSpock() {
  const [token, setToken] = useState('')
  const [pin, setPin] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [finalMs, setFinalMs] = useState<number | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const waking = phase === 'waking'
  const cooling = cooldownUntil > now

  useEffect(() => {
    if (!waking && !cooling) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waking, cooling])

  useEffect(() => () => abortRef.current?.abort(), [])

  const wake = async () => {
    const usedPin = pin
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const t0 = Date.now()
    setStartedAt(t0)
    setNow(t0)
    setFinalMs(null)
    setMessage('')
    setPhase('waking')
    try {
      const res = await fetch('/api/spock/wake', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(usedPin ? { pin: usedPin } : {}),
        signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => ({}))) as WakeReply
      const end = Date.now()
      setNow(end)
      setFinalMs(data.elapsedMs ?? end - t0)

      if (res.status === 429) {
        setCooldownUntil(end + (data.retryAfterMs ?? (data.status === 'cooldown' ? COOLDOWN_FALLBACK_MS : LOCKOUT_FALLBACK_MS)))
        setMessage(data.message ?? 'Too many attempts, locked out. Wait for the countdown.')
        setPhase('error')
      } else if (res.status === 401) {
        setMessage('Wake token rejected')
        setPhase('error')
      } else if (res.status === 409) {
        setMessage('A wake is already running')
        setPhase('error')
      } else if (res.status === 503) {
        setMessage('Wake is not configured on the server')
        setPhase('error')
      } else if (res.ok && (data.status === 'awake' || data.status === 'already_awake')) {
        setMessage(data.status === 'already_awake' ? 'SPOCK is already awake' : 'SPOCK is awake')
        setPhase('awake')
      } else if (res.ok && data.status === 'timeout') {
        if (usedPin) setCooldownUntil(end + COOLDOWN_FALLBACK_MS)
        setMessage(data.message ?? (usedPin ? PIN_WARNING : 'SPOCK did not answer in time'))
        setPhase('timeout')
      } else {
        setMessage(data.message ?? data.error ?? `Request failed (${res.status})`)
        setPhase('error')
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setMessage('Cancelled (the wake may still be running on the server)')
      } else {
        setMessage('Request failed')
      }
      setFinalMs(Date.now() - t0)
      setPhase('error')
    } finally {
      abortRef.current = null
      setPin('')
    }
  }

  const elapsed = waking ? now - startedAt : finalMs
  const statusText =
    phase === 'idle' ? 'Idle'
    : waking ? `Waking… ${fmt(elapsed ?? 0)} (probing every 3s, up to ~2 min)`
    : `${phase === 'awake' ? 'Awake' : phase === 'timeout' ? 'Timeout' : 'Error'}${elapsed != null ? ` after ${fmt(elapsed)}` : ''}`

  const disabled = waking || cooling || !token

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Wake SPOCK</h2>
      </div>

      <div className="bg-surface border border-brd rounded-[10px] p-4 flex flex-col gap-3">
        <div className="form-row">
          <label className="form-label" htmlFor="wk-token">Wake token</label>
          <input
            id="wk-token"
            aria-label="Wake token"
            className="form-input"
            type="password"
            autoComplete="off"
            value={token}
            disabled={waking}
            onChange={e => setToken(e.target.value)}
            placeholder="SPOCK_WAKE_TOKEN (kept in memory only)"
          />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="wk-pin">PIN (optional)</label>
          <input
            id="wk-pin"
            aria-label="PIN"
            className="form-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            disabled={waking}
            onChange={e => setPin(e.target.value)}
            placeholder="Windows PIN, if SPOCK is locked"
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={wake} disabled={disabled} className="btn-primary">
            {cooling ? `Wake SPOCK (retry in ${fmt(cooldownUntil - now)})` : 'Wake SPOCK'}
          </button>
          {waking && (
            <button onClick={() => abortRef.current?.abort()} className="btn-ghost">Cancel</button>
          )}
        </div>

        <div role="status" className="font-mono text-[0.8rem] text-txt-2">{statusText}</div>
        {message && (
          <div className={phase === 'awake' ? 'text-[0.8rem] text-emerald' : 'text-[0.8rem] text-amber-400'}>
            {message}
          </div>
        )}
        {cooling && (
          <div className="text-[0.75rem] text-txt-3">
            PIN wakes are locked for {fmt(cooldownUntil - now)}.
          </div>
        )}
      </div>
    </section>
  )
}
