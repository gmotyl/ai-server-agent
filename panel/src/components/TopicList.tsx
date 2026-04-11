import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../api'
import { fmtTime } from '../lib/format'
import { TopicMessages } from './TopicMessages'
import { showToast } from './Toast'
import type { Topic } from '../types'
import clsx from 'clsx'

type Tab = 'active' | 'archive'

function RenameInput({ topic, onDone }: { topic: Topic; onDone: (newLabel: string | null) => void }) {
  const [val, setVal] = useState(topic.label)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  const save = async () => {
    if (!val.trim() || val.trim() === topic.label) { onDone(null); return }
    await api<unknown>('PUT', `/topics/${topic.id}/rename`, { label: val.trim() })
    onDone(val.trim())
  }

  return (
    <input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone(null) }}
      className="font-semibold text-[0.88rem] bg-surface border border-lime/50 rounded px-1.5 py-0.5 w-full outline-none focus:border-lime"
    />
  )
}

function TopicCard({
  topic,
  expanded,
  onToggle,
  onClose,
  onArchive,
  onUnarchive,
  onDelete,
  onRenamed,
}: {
  topic: Topic
  expanded: boolean
  onToggle: () => void
  onClose: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
  onRenamed: (label: string) => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div className="bg-surface border border-brd rounded-[10px] transition-colors hover:border-brd-2">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameInput
              topic={topic}
              onDone={label => {
                setRenaming(false)
                if (label) onRenamed(label)
              }}
            />
          ) : (
            <div className="flex items-center gap-1.5 group">
              <div
                className="font-semibold text-[0.88rem] truncate cursor-pointer transition-colors hover:text-lime"
                onClick={onToggle}
              >
                {topic.label}
              </div>
              <button
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-txt-3 hover:text-lime"
                title="Rename"
                onClick={e => { e.stopPropagation(); setRenaming(true) }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M11.3 2.7a1.41 1.41 0 0 1 2 2L5 13H3v-2l8.3-8.3z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap mt-0.5">
            <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-surface-3 text-txt-2">{topic.provider}</span>
            <span className="font-mono text-[0.7rem] text-txt-3">{topic.messageCount} msgs</span>
            <span className="font-mono text-[0.7rem] text-txt-3">{fmtTime(topic.lastActivity) || 'No activity'}</span>
            {!topic.archived && (
              <span className={clsx(
                'font-mono text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                topic.active ? 'bg-emerald/12 text-emerald' : 'bg-surface-3 text-txt-3'
              )}>
                {topic.active ? 'Active' : 'Closed'}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {topic.active && !topic.archived && (
            <button className="icon-btn warn" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          )}
          {!topic.archived ? (
            <button className="icon-btn warn" onClick={onArchive} title="Archive">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M6.5 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <button className="icon-btn" onClick={onUnarchive} title="Unarchive">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M8 11.5V8.5m0 0l-1.5 1.5M8 8.5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button className="icon-btn danger" onClick={onDelete} title="Delete">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-brd px-4 py-3 bg-bg rounded-b-[10px]">
          <TopicMessages topicId={topic.id} />
        </div>
      )}
    </div>
  )
}

export function TopicList() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState<Tab>('active')

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

  const archiveTopic = async (id: string) => {
    await api<unknown>('POST', `/topics/${id}/archive`)
    showToast('Archived')
    load()
  }

  const unarchiveTopic = async (id: string) => {
    await api<unknown>('POST', `/topics/${id}/unarchive`)
    showToast('Unarchived')
    load()
  }

  const deleteTopic = async (id: string) => {
    if (!confirm('Delete this topic and all its messages?')) return
    await api<unknown>('DELETE', `/topics/${id}`)
    showToast('Topic deleted')
    if (expandedId === id) setExpandedId(null)
    load()
  }

  const handleRenamed = (id: string, label: string) => {
    showToast(`Renamed to "${label}"`)
    setTopics(prev => prev.map(t => t.id === id ? { ...t, label } : t))
  }

  const activeTopics = topics.filter(t => !t.archived && t.active)
  const archivedTopics = topics.filter(t => t.archived || !t.active)

  const displayedTopics = tab === 'active' ? activeTopics : archivedTopics

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display font-bold text-xl tracking-tight">Topics</h2>
          <div className="flex bg-surface border border-brd rounded-lg overflow-hidden text-xs font-mono">
            <button
              onClick={() => setTab('active')}
              className={clsx(
                'px-3 py-1.5 transition-colors',
                tab === 'active' ? 'bg-lime/15 text-lime' : 'text-txt-3 hover:text-txt-2'
              )}
            >
              Active ({activeTopics.length})
            </button>
            <button
              onClick={() => setTab('archive')}
              className={clsx(
                'px-3 py-1.5 border-l border-brd transition-colors',
                tab === 'archive' ? 'bg-lime/15 text-lime' : 'text-txt-3 hover:text-txt-2'
              )}
            >
              Archive ({archivedTopics.length})
            </button>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={load} className="icon-btn" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0 1 10.3-4.2M14 2v4h-4M14 8a6 6 0 0 1-10.3 4.2M2 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={syncTelegram} disabled={syncing} className="icon-btn" title="Sync from Telegram">
            {syncing
              ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" /></svg>
              : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.05 3.05l2.12 2.12M10.83 10.83l2.12 2.12M3.05 12.95l2.12-2.12M10.83 5.17l2.12-2.12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            }
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-txt-3 font-mono text-sm">Loading...</div>
      ) : displayedTopics.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2 opacity-40">{tab === 'archive' ? '🗃' : '💬'}</div>
          <div className="text-txt-3 text-sm">
            {tab === 'archive' ? 'No archived topics.' : 'No topics yet. Send a message via Telegram to get started.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayedTopics.map((t, i) => (
            <div
              key={t.id}
              className="animate-fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <TopicCard
                topic={t}
                expanded={expandedId === t.id}
                onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                onClose={() => closeTopic(t.id)}
                onArchive={() => archiveTopic(t.id)}
                onUnarchive={() => unarchiveTopic(t.id)}
                onDelete={() => deleteTopic(t.id)}
                onRenamed={label => handleRenamed(t.id, label)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
