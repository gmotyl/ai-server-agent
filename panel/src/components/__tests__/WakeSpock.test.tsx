import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WakeSpock } from '../WakeSpock'

const PIN_WARNING = 'PIN may not have worked, check the screen'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('WakeSpock', () => {
  beforeEach(() => { vi.useFakeTimers() })
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
    const btn = screen.getByRole('button', { name: /wake spock|retry in/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/30s/)

    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
    expect((screen.getByRole('button', { name: /wake spock/i }) as HTMLButtonElement).disabled).toBe(false)
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
