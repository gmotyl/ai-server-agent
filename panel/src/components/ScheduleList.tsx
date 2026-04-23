import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { cronToHuman } from '../lib/cron'
import { ScheduleForm } from './ScheduleForm'
import { showToast } from './Toast'
import type { Schedule } from '../types'

export function ScheduleList() {
  const { status } = useStore()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [logsName, setLogsName] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await api<Schedule[]>('GET', '/schedules')
    setSchedules(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (name: string) => {
    await api<unknown>('POST', `/schedules/${encodeURIComponent(name)}/run`)
    showToast(`▶ Running '${name}'`)
  }

  const del = async (name: string) => {
    if (!confirm(`Delete schedule '${name}'?`)) return
    await api<unknown>('DELETE', `/schedules/${encodeURIComponent(name)}`)
    showToast('Schedule deleted')
    load()
  }

  const onFormDone = () => {
    setEditingName(null)
    setShowAdd(false)
    load()
  }

  const toggleLogs = async (name: string) => {
    if (logsName === name) {
      setLogsName(null)
      setLogs([])
      return
    }
    setLogsName(name)
    setLogsLoading(true)
    try {
      const data = await api<{ logs: string[] }>('GET', `/schedules/${encodeURIComponent(name)}/logs`)
      setLogs(data.logs)
    } catch (e: unknown) {
      showToast((e as Error).message)
    } finally {
      setLogsLoading(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Scheduler</h2>
        <button onClick={() => { setShowAdd(true); setEditingName(null) }} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>New Task</span>
        </button>
      </div>


      {loading ? (
        <div className="text-center py-12 text-txt-3 font-mono text-sm">Loading...</div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2 opacity-40">⏰</div>
          <div className="text-txt-3 text-sm">No scheduled tasks. Click "New Task" to create one.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((s, i) => {
            const human = cronToHuman(s.cron)
            const lastRun = s.lastRun
              ? s.lastRun.replace(/-/g, (_m, idx: number) => idx > 9 ? ':' : '-')
              : 'Never'
            const isLogsOpen = logsName === s.name

            return (
              <div
                key={s.name}
                className="bg-surface border border-brd rounded-[10px] transition-colors hover:border-brd-2 animate-fade-up"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[0.88rem] truncate">{s.name}</div>
                    <div className="flex items-center gap-3 flex-wrap mt-0.5">
                      <span className="font-mono text-[0.82rem] font-semibold text-txt">{human}</span>
                      <span className="font-mono text-[0.65rem] text-txt-3">{s.cron}</span>
                      <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-surface-3 text-txt-2">
                        {s.provider || status?.defaultProvider || 'default'}
                      </span>
                      <span className="font-mono text-[0.7rem] text-txt-3 truncate max-w-[200px]" title={s.prompt}>
                        {s.prompt}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="font-mono text-[0.7rem] text-txt-3">📂 {s.workdir || '/git'}</span>
                      <span className="font-mono text-[0.7rem] text-txt-3">Last: {lastRun}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 w-full sm:w-auto justify-between sm:justify-end border-t border-brd/40 sm:border-0 pt-2.5 sm:pt-0">
                    <button className="btn-run flex-1 sm:flex-none justify-center" onClick={() => run(s.name)} title="Run now">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor" /></svg>
                      Run
                    </button>
                    <div className="flex gap-2">
                      <button
                        className={`icon-btn${isLogsOpen ? ' active' : ''}`}
                        onClick={() => toggleLogs(s.name)}
                        title="View logs"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M2 4h12M2 8h8M2 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <button className="icon-btn" onClick={() => { setEditingName(s.name); setShowAdd(false) }} title="Edit">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
                      </button>
                      <button className="icon-btn danger" onClick={() => del(s.name)} title="Delete">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </div>
                </div>

                {isLogsOpen && (
                  <div className="border-t border-brd px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-txt-2">Logs — {s.name}</span>
                      <span className="text-xs text-txt-3">ostatnie wpisy (najnowsze na górze)</span>
                    </div>
                    {logsLoading ? (
                      <div className="text-xs text-txt-3 font-mono py-2">Ładowanie…</div>
                    ) : logs.length === 0 ? (
                      <div className="text-xs text-txt-3 font-mono py-2">Brak logów dla tego schedulera.</div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto font-mono text-[0.7rem] leading-relaxed bg-surface-2 rounded-lg px-3 py-2 border border-brd space-y-0.5">
                        {logs.map((line, idx) => {
                          const isError = line.includes('[ERROR]')
                          const isWarn = line.includes('[WARN]')
                          return (
                            <div
                              key={idx}
                              className={isError ? 'text-red-400' : isWarn ? 'text-amber' : 'text-txt-2'}
                            >
                              {line}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {editingName === s.name && (
                  <div className="border-t border-brd px-4 py-3">
                    <ScheduleForm
                      schedule={s}
                      onDone={onFormDone}
                      onCancel={() => setEditingName(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <ScheduleForm onDone={onFormDone} onCancel={() => setShowAdd(false)} />
      )}
    </section>
  )
}
