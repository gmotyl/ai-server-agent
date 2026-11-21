import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WakeSpock, resetWakeStore } from '../WakeSpock'

const PIN_WARNING = 'PIN may not have worked, check the screen'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('WakeSpock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetWakeStore()
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders button, masked numeric PIN field and status', () => {
    render(<WakeSpock />)
    expect(screen.getByRole('button', { name: /wake spock/i })).toBeTruthy()
    const pin = screen.getByLabelText('PIN')
    expect(pin.getAttribute('type')).toBe('password')
    expect(pin.getAttribute('inputmode')).toBe('numeric')
    expect(pin.getAttribute('autocomplete')).toBe('off')
    expect(screen.getByRole('status').textContent).toMatch(/idle/i)
  })

  it('posts the PIN and shows progress', async () => {
    let resolve!: (r: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>(r => { resolve = r }))
    vi.stubGlobal('fetch', fetchMock)
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    fireEvent.click(screen.getByRole('button', { name: /wake spock/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/spock/wake')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ pin: '1234' })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByRole('status').textContent).toMatch(/waking.*5s/i)

    await act(async () => { resolve(jsonResponse(200, { status: 'awake', elapsedMs: 7000 })) })
    expect(screen.getByRole('status').textContent).toMatch(/awake/i)
  })

  it('shows PIN warning and disables during cooldown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { status: 'cooldown', message: PIN_WARNING, retryAfterMs: 30000 })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })

    expect(screen.getByText(new RegExp(PIN_WARNING))).toBeTruthy()
    fill('PIN', '1234')
    const btn = screen.getByRole('button', { name: /wake spock|retry in/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/30s/)

    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('PIN cooldown blocks only PIN wakes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { status: 'cooldown', message: PIN_WARNING, retryAfterMs: 30000 })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    // PIN cleared after the request: a PIN-less wake is allowed
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
    fill('PIN', '1234')
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(true)
    fill('PIN', '')
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('auth lockout blocks all wakes for retryAfterMs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { status: 'locked_out', error: 'Too many failed attempts', retryAfterMs: 45000 })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    const btn = screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/45s/)
    await act(async () => { await vi.advanceTimersByTimeAsync(46000) })
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('clears the lockout message when the countdown expires', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { status: 'locked_out', error: 'Too many failed attempts', retryAfterMs: 10000 })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    expect(screen.getByText(/locked out/i)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(11000) })
    expect(screen.queryByText(/locked out/i)).toBeNull()
    expect(screen.queryByText(/locked for/i)).toBeNull()
  })

  it('cancel while reading a 429 body does not become a lockout', async () => {
    const res = { status: 429, ok: false, json: () => Promise.reject(new DOMException('aborted', 'AbortError')) }
    vi.stubGlobal('fetch', vi.fn(async () => res as unknown as Response))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    expect(screen.getByText(/cancelled/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/locked/i)).toBeNull()
  })

  it('PIN timeout cooldown uses retryAfterMs from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'timeout', elapsedMs: 120000, message: PIN_WARNING, retryAfterMs: 20000 })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    fill('PIN', '1234')
    expect(screen.getByRole('button', { name: /wake spock/i }).textContent).toMatch(/20s/)
  })

  it('keeps an in-flight wake across remount (tab switch)', async () => {
    let resolve!: (r: Response) => void
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_u: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise<Response>(r => { resolve = r }) })
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<WakeSpock />)
    fill('Wake token', 'tok')
    fireEvent.click(screen.getByRole('button', { name: /wake spock/i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    first.unmount()
    expect(signal?.aborted).toBe(false)

    render(<WakeSpock />)
    expect(screen.getByRole('status').textContent).toMatch(/waking.*4s/i)
    await act(async () => { resolve(jsonResponse(200, { status: 'awake', elapsedMs: 9000 })) })
    expect(screen.getByRole('status').textContent).toMatch(/awake/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('disables the whole wake form outside a secure context', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    expect((screen.getByLabelText('PIN') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Wake token') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Wake SPOCK needs the HTTPS (tailnet) URL')).toBeTruthy()
  })

  it('clears the PIN field after the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { status: 'timeout', elapsedMs: 120000, message: `${PIN_WARNING}. x` })))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    fill('PIN', '1234')
    expect((screen.getByLabelText('PIN') as HTMLInputElement).value).toBe('1234')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })

    expect((screen.getByLabelText('PIN') as HTMLInputElement).value).toBe('')
    expect(setItem).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain('1234')
  })

  it('shows a specific message for 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: 'Wake disabled' })))
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    expect(screen.getByText('Wake is not configured on the server')).toBeTruthy()
  })

  it('never leaks PIN or token to console, cookie or URL', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    const cookie = document.cookie
    const href = location.href
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))
    render(<WakeSpock />)
    fill('Wake token', 'secret-token-xyz')
    fill('PIN', '987654')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    const logged = JSON.stringify(spies.flatMap(s => s.mock.calls))
    expect(logged).not.toContain('987654')
    expect(logged).not.toContain('secret-token-xyz')
    expect(document.cookie).toBe(cookie)
    expect(location.href).toBe(href)
    expect(location.hash).toBe('')
    spies.forEach(s => s.mockRestore())
  })

  it('does not auto-retry after a timeout', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: 'timeout', elapsedMs: 120000 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<WakeSpock />)
    fill('Wake token', 'tok')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /wake spock/i })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
