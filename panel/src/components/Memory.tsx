import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { showToast } from './Toast'

export function Memory() {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ content: string }>('GET', '/memory')
      setContent(data.content)
      setOriginal(data.content)
    } catch (e: unknown) {
      showToast((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await api('PUT', '/memory', { content })
      setOriginal(content)
      showToast('Memory saved')
    } catch (e: unknown) {
      showToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = content !== original

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-txt">Memory</h2>
          <p className="text-xs text-txt-3 mt-0.5">memory/MEMORY.md — persists across conversations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brd text-txt-3 hover:text-txt-2 hover:bg-surface-2 text-xs font-medium transition-all cursor-pointer disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 2.5A7 7 0 1 0 14.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M14.5 2.5v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Reload
          </button>
          <button
            onClick={save}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lime text-bg text-xs font-semibold transition-all cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25 10" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 5l-6 6-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            Save
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative">
        {loading ? (
          <div className="flex items-center justify-center h-64 bg-surface-2 rounded-xl border border-brd text-txt-3 text-sm">
            Loading…
          </div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              className="w-full h-[65vh] min-h-[320px] bg-surface-2 border border-brd rounded-xl px-4 py-3 font-mono text-sm text-txt leading-relaxed resize-y focus:outline-none focus:border-lime transition-colors"
              placeholder="# Memory Index&#10;&#10;No memory yet."
            />
            {isDirty && (
              <span className="absolute top-2.5 right-3 text-[0.65rem] text-amber font-medium select-none">
                unsaved
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
