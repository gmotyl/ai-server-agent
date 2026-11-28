import { useEffect, useState, useSyncExternalStore } from 'react'

const PIN_WARNING = 'PIN may not have worked, check the screen'
const LOCKOUT_FALLBACK_MS = 60_000 // matches server auth lockout default
const LOCKOUT_MSG = 'Too many failed attempts, locked out. Wait for the countdown.'
const ALREADY_AWAKE_MSG = 'SPOCK answers on the network, but the screen may still be off or locked. Send the sequence anyway?'
const CANCELLED_MSG = 'Cancelled (the wake may still be running on the server)'

type Phase = 'idle' | 'waking' | 'awake' | 'already_awake' | 'timeout' | 'error'

interface WakeReply {
  status?: string
  message?: string
  error?: string
  elapsedMs?: number
  retryAfterMs?: number
}

interface WakeState {
  phase: Phase
  message: string
  startedAt: number
  finalMs: number | null
  forced: boolean // current/last wake skipped the preflight probe
  pinCooldownUntil: number // blocks PIN wakes only
  lockoutUntil: number // auth lockout: blocks every wake
}

const INITIAL: WakeState = { phase: 'idle', message: '', startedAt: 0, finalMs: null, forced: false, pinCooldownUntil: 0, lockoutUntil: 0 }

// Module-level so a wake survives the tab unmounting; never holds the token or PIN.
let state: WakeState = INITIAL
let inflight: AbortController | null = null
let lockoutTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function update(patch: Partial<WakeState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

function startLockout(ms: number) {
  update({ phase: 'error', message: LOCKOUT_MSG, lockoutUntil: Date.now() + ms })
  if (lockoutTimer) clearTimeout(lockoutTimer)
  // module-level so the message clears even if the tab is not mounted
  lockoutTimer = setTimeout(() => {
    lockoutTimer = null
    if (state.message === LOCKOUT_MSG) update({ phase: 'idle', message: '', finalMs: null })
  }, ms)
}

export function resetWakeStore() {
  if (lockoutTimer) clearTimeout(lockoutTimer)
  lockoutTimer = null
  state = INITIAL
  inflight = null
  listeners.forEach(l => l())
}

async function startWake(token: string, pin: string, force = false) {
  const ctrl = new AbortController()
  inflight = ctrl
  const t0 = Date.now()
  update({ phase: 'waking', startedAt: t0, finalMs: null, message: '', forced: force })
  try {
    const res = await fetch('/api/spock/wake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(pin ? { pin } : {}), ...(force ? { force: true } : {}) }),
      signal: ctrl.signal,
    })
    let parsed: WakeReply | null = null
    let bodyAborted = false
    try { parsed = (await res.json()) as WakeReply } catch (e) {
      bodyAborted = e instanceof DOMException && e.name === 'AbortError'
    }
    const cancelled = ctrl.signal.aborted || bodyAborted
    if (cancelled || (parsed === null && res.status === 429)) {
      // unread body: never guess a lockout or cooldown from the bare status
      update({ finalMs: Date.now() - t0, phase: 'error', message: cancelled ? CANCELLED_MSG : 'Request failed (429)' })
      return
    }
    const data = parsed ?? {}
    const end = Date.now()
    const finalMs = data.elapsedMs ?? end - t0

    if (res.status === 429 && data.status === 'cooldown') {
      update({ finalMs, phase: 'error', message: data.message ?? PIN_WARNING, pinCooldownUntil: end + (data.retryAfterMs ?? 0) })
    } else if (res.status === 429 && data.status === 'locked_out') {
      update({ finalMs })
      startLockout(data.retryAfterMs ?? LOCKOUT_FALLBACK_MS)
    } else if (res.status === 401) {
      update({ finalMs, phase: 'error', message: 'Wake token rejected' })
    } else if (res.status === 403 && data.error === 'https_required') {
      update({ finalMs, phase: 'error', message: 'Wake SPOCK needs the HTTPS (tailnet) URL' })
    } else if (res.status === 409) {
      update({ finalMs, phase: 'error', message: 'A wake is already running' })
    } else if (res.status === 503) {
      update({ finalMs, phase: 'error', message: 'Wake is not configured on the server' })
    } else if (res.ok && data.status === 'already_awake') {
      update({ finalMs, phase: 'already_awake', message: ALREADY_AWAKE_MSG })
    } else if (res.ok && data.status === 'awake') {
      update({ finalMs, phase: 'awake', message: force ? 'Sequence sent, SPOCK answers (check the screen)' : 'SPOCK is awake' })
    } else if (res.ok && data.status === 'not_responding') {
      update({ finalMs, phase: 'timeout', message: 'Sequence sent, but SPOCK does not answer' })
    } else if (res.ok && data.status === 'timeout') {
      update({
        finalMs, phase: 'timeout',
        message: data.message ?? (pin ? PIN_WARNING : 'SPOCK did not answer in time'),
        // server sends retryAfterMs only when a PIN cooldown is configured
        ...(pin && data.retryAfterMs ? { pinCooldownUntil: end + data.retryAfterMs } : {}),
      })
    } else {
      update({ finalMs, phase: 'error', message: data.message ?? data.error ?? `Request failed (${res.status})` })
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    update({
      finalMs: Date.now() - t0, phase: 'error',
      message: aborted ? CANCELLED_MSG : 'Request failed',
    })
  } finally {
    if (inflight === ctrl) inflight = null
  }
}

const fmt = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))}s`

// Token and PIN are remembered in this device's localStorage (HTTPS origin only) so the phone app is one tap.
const TOKEN_KEY = 'spockWakeToken'
const PIN_KEY = 'spockWakePin'

function load(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

function save(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { /* storage unavailable: keep in memory only */ }
}

export function WakeSpock() {
  const s = useSyncExternalStore(subscribe, snapshot)
  const [token, setTokenState] = useState(() => load(TOKEN_KEY))
  const [pin, setPinState] = useState(() => load(PIN_KEY))
  const setToken = (v: string) => { setTokenState(v); save(TOKEN_KEY, v) }
  const setPin = (v: string) => { setPinState(v); save(PIN_KEY, v) }
  const forget = () => { setToken(''); setPin('') }
  const [now, setNow] = useState(() => Date.now())
  const secure = typeof window !== 'undefined' && !!window.isSecureContext

  const waking = s.phase === 'waking'
  const pinCooling = s.pinCooldownUntil > now
  const locked = s.lockoutUntil > now
  const pinBlocked = !!pin && pinCooling

  useEffect(() => {
    if (!waking && !pinCooling && !locked) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waking, pinCooling, locked])

  const wake = (force = false) => {
    if (!secure) return
    setNow(Date.now())
    void startWake(token, pin, force)
  }

  const elapsed = waking ? now - s.startedAt : s.finalMs
  const statusText =
    s.phase === 'idle' ? 'Idle'
    : waking ? (s.forced ? `Sending sequence… ${fmt(elapsed ?? 0)} (one check when it finishes)` : `Waking… ${fmt(elapsed ?? 0)} (probing every 3s, up to ~2 min)`)
    : `${s.phase === 'awake' ? 'Awake' : s.phase === 'already_awake' ? 'Already awake?' : s.phase === 'timeout' ? 'Timeout' : 'Error'}${elapsed != null ? ` after ${fmt(elapsed)}` : ''}`

  const disabled = !secure || waking || locked || pinBlocked || !token
  const retryIn = locked ? s.lockoutUntil - now : pinBlocked ? s.pinCooldownUntil - now : 0

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
            disabled={waking || !secure}
            onChange={e => setToken(e.target.value)}
            placeholder="SPOCK_WAKE_TOKEN (saved on this device)"
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
            disabled={waking || !secure}
            onChange={e => setPin(e.target.value)}
            placeholder="Windows PIN (saved on this device)"
          />
        </div>
        {!secure && (
          <div className="text-[0.75rem] text-txt-3">
            Wake SPOCK needs the HTTPS (tailnet) URL
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={() => wake()} disabled={disabled} className="btn-primary">
            {retryIn > 0 ? `Wake SPOCK (retry in ${fmt(retryIn)})` : 'Wake SPOCK'}
          </button>
          {s.phase === 'already_awake' && (
            <button onClick={() => wake(true)} disabled={disabled} className="btn-ghost">Send anyway</button>
          )}
          {waking && (
            <button onClick={() => inflight?.abort()} className="btn-ghost">Cancel</button>
          )}
          {!waking && (token || pin) && (
            <button onClick={forget} className="btn-ghost">Forget token &amp; PIN</button>
          )}
        </div>

        <div role="status" className="font-mono text-[0.8rem] text-txt-2">{statusText}</div>
        {s.message && (
          <div className={s.phase === 'awake' ? 'text-[0.8rem] text-emerald' : 'text-[0.8rem] text-amber-400'}>
            {s.message}
          </div>
        )}
        {locked && (
          <div className="text-[0.75rem] text-txt-3">
            All wakes are locked for {fmt(s.lockoutUntil - now)} after failed token attempts.
          </div>
        )}
        {!locked && pinCooling && (
          <div className="text-[0.75rem] text-txt-3">
            PIN wakes are locked for {fmt(s.pinCooldownUntil - now)}. Wake without PIN still works.
          </div>
        )}
      </div>
    </section>
  )
}
