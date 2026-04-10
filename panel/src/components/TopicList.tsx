import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import { fmtTime } from '../lib/format'
import { TopicMessages } from './TopicMessages'
import { showToast } from './Toast'
import type { Topic } from '../types'
import clsx from 'clsx'

export function TopicList() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await api<Topic[]>('GET', '/topics')
    setTopics(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const syncTelegram = async () => {
    setSyncing(true)
    try {
      const result = await api<{ updatesScanned: number; namesFound: number; closedFound: number; reopenedFound: number }>('POST', '/topics/sync')
      showToast(`Sync done: ${result.updatesScanned} updates scanned, ${result.namesFound} names, ${result.closedFound} closed, ${result.reopenedFound} reopened`)
      load()
    } catch {
      showToast('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const closeTopic = async (id: string) => {
    await api<unknown>('POST', `/topics/${id}/close`)
    showToast('Topic closed')
    load()
  }

  const deleteTopic = async (id: string) => {
    if (!confirm('Delete this topic and all its messages?')) return
    await api<unknown>('DELETE', `/topics/${id}`)
    showToast('Topic deleted')
    if (expandedId === id) setExpandedId(null)
    load()
  }

  const purgeClosedTopics = async () => {
    const closed = topics.filter(t => !t.active)
    if (closed.length === 0) { showToast('No closed topics to delete'); return }
    if (!confirm(`Permanently delete ${closed.length} closed topic(s)?`)) return
    for (const t of closed) await api<unknown>('DELETE', `/topics/${t.id}`)
    showToast(`Purged ${closed.length} topics`)
    setExpandedId(null)
    load()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Topic History</h2>
        <div className="flex gap-1.5">
          <button onClick={load} className="icon-btn" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0 1 10.3-4.2M14 2v4h-4M14 8a6 6 0 0 1-10.3 4.2M2 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={syncTelegram} disabled={syncing} className="icon-btn" title="Sync closed topics from Telegram">
            {syncing
              ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" /></svg>
              : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.05 3.05l2.12 2.12M10.83 10.83l2.12 2.12M3.05 12.95l2.12-2.12M10.83 5.17l2.12-2.12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            }
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-txt-3 font-mono text-sm">Loading...</div>
      ) : topics.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2 opacity-40">💬</div>
          <div className="text-txt-3 text-sm">No topics yet. Send a message via Telegram to get started.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {topics.map((t, i) => (
            <div
              key={t.id}
              className="bg-surface border border-brd rounded-[10px] transition-colors hover:border-brd-2 animate-fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              {/* Card row */}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div
                    className="font-semibold text-[0.88rem] truncate cursor-pointer transition-colors hover:text-lime"
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  >
                    {t.label}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mt-0.5">
                    <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-surface-3 text-txt-2">{t.provider}</span>
                    <span className="font-mono text-[0.7rem] text-txt-3">{t.messageCount} msgs</span>
                    <span className="font-mono text-[0.7rem] text-txt-3">{fmtTime(t.lastActivity) || 'No activity'}</span>
                    <span className={clsx(
                      'font-mono text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                      t.active ? 'bg-emerald/12 text-emerald' : 'bg-surface-3 text-txt-3'
                    )}>
                      {t.active ? 'Active' : 'Closed'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {t.active && (
                    <button className="icon-btn warn" onClick={() => closeTopic(t.id)} title="Close">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                  )}
                  <button className="icon-btn danger" onClick={() => deleteTopic(t.id)} title="Delete">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              </div>

              {/* Expanded messages */}
              {expandedId === t.id && (
                <div className="border-t border-brd px-4 py-3 bg-bg rounded-b-[10px]">
                  <TopicMessages topicId={t.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <button onClick={purgeClosedTopics} className="btn-danger-sm">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Purge closed</span>
        </button>
      </div>
    </section>
  )
}
