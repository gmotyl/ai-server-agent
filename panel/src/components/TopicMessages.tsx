import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmtTime, truncate } from '../lib/format'
import type { Message } from '../types'
import clsx from 'clsx'

const fromStyle: Record<string, { label: string; color: string; bg: string; border: string }> = {
  user: { label: 'USER', color: 'text-cyan', bg: 'bg-cyan-dim', border: 'border-cyan/20' },
  schedule: { label: 'SCHEDULE', color: 'text-amber', bg: 'bg-amber-dim', border: 'border-amber/20' },
}
const agentStyle = { label: 'AGENT', color: 'text-emerald', bg: 'bg-emerald/8', border: 'border-emerald/20' }

export function TopicMessages({ topicId }: { topicId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    api<Message[]>('GET', `/topics/${topicId}/messages`)
      .then(setMessages)
      .finally(() => setLoading(false))
  }, [topicId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (loading) {
    return <div className="py-6 text-center text-txt-3 text-sm font-mono">Loading messages...</div>
  }

  if (messages.length === 0) {
    return <div className="py-6 text-center text-txt-3 text-sm">No messages recorded</div>
  }

  return (
    <div ref={scrollRef} className="max-h-[400px] overflow-y-auto space-y-3 py-1 pr-1">
      {messages.map((m, i) => {
        const style = fromStyle[m.from] ?? agentStyle
        return (
          <div key={i} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 0.02, 0.3)}s` }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={clsx('font-mono text-[0.65rem] font-semibold uppercase tracking-wide', style.color)}>
                {style.label}
              </span>
              <span className="font-mono text-[0.65rem] text-txt-3">{fmtTime(m.ts)}</span>
            </div>
            <div className={clsx(
              'text-[0.82rem] leading-relaxed px-3 py-2 rounded-lg border max-w-[90%] whitespace-pre-wrap break-words',
              style.bg, style.border, 'text-txt-2'
            )}>
              {truncate(m.text, 800)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
