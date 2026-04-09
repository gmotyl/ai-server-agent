import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api, setApiToken } from './api'
import type { Status } from './types'

interface StoreCtx {
  token: string
  setToken: (t: string) => void
  status: Status | null
  refreshStatus: () => Promise<void>
  providers: string[]
  logout: () => void
  isAuthenticated: boolean
}

const Ctx = createContext<StoreCtx>(null!)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => localStorage.getItem('admin_token') || '')
  const [status, setStatus] = useState<Status | null>(null)
  const [authed, setAuthed] = useState(false)

  const setToken = useCallback((t: string) => {
    setTokenState(t)
    setApiToken(t)
    localStorage.setItem('admin_token', t)
  }, [])

  const logout = useCallback(() => {
    setTokenState('')
    setApiToken('')
    localStorage.removeItem('admin_token')
    setStatus(null)
    setAuthed(false)
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api<Status>('GET', '/status')
      setStatus(s)
      setAuthed(true)
    } catch {
      setAuthed(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      setApiToken(token)
      refreshStatus()
    }
  }, [token, refreshStatus])

  return (
    <Ctx.Provider value={{
      token,
      setToken,
      status,
      refreshStatus,
      providers: status?.providers ?? [],
      logout,
      isAuthenticated: authed,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useStore() {
  return useContext(Ctx)
}
