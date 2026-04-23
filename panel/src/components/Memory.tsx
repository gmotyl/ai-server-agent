import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../api'
import { showToast } from './Toast'

interface LinkedFile {
  text: string
  path: string
}

function extractLinks(md: string): LinkedFile[] {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g
  const links: LinkedFile[] = []
  let m
  while ((m = re.exec(md)) !== null) {
    const href = m[2]
    // Only relative paths (not URLs or anchors)
    if (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('/')) {
      links.push({ text: m[1], path: href })
    }
  }
  return links
}

export function Memory() {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Linked file editor state
  const [selectedFile, setSelectedFile] = useState<LinkedFile | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileOriginal, setFileOriginal] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileSaving, setFileSaving] = useState(false)

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

  const linkedFiles = useMemo(() => extractLinks(content), [content])
  const isDirty = content !== original

  const openFile = async (file: LinkedFile) => {
    if (selectedFile?.path === file.path) {
      setSelectedFile(null)
      return
    }
    setSelectedFile(file)
    setFileLoading(true)
    try {
      // filename is the last segment of the path (handles subdir links too, but security is enforced server-side)
      const filename = file.path.split('/').pop() || file.path
      const data = await api<{ content: string }>('GET', `/memory/file/${encodeURIComponent(filename)}`)
      setFileContent(data.content)
      setFileOriginal(data.content)
    } catch (e: unknown) {
      showToast((e as Error).message)
      setSelectedFile(null)
    } finally {
      setFileLoading(false)
    }
  }

  const saveFile = async () => {
    if (!selectedFile) return
    setFileSaving(true)
    try {
      const filename = selectedFile.path.split('/').pop() || selectedFile.path
      await api('PUT', `/memory/file/${encodeURIComponent(filename)}`, { content: fileContent })
      setFileOriginal(fileContent)
      showToast(`${filename} saved`)
    } catch (e: unknown) {
      showToast((e as Error).message)
    } finally {
      setFileSaving(false)
    }
  }

  const isFileDirty = fileContent !== fileOriginal

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

      {/* Linked files */}
      {!loading && linkedFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-txt-3 uppercase tracking-wider">Linked files</div>
          <div className="flex flex-wrap gap-2">
            {linkedFiles.map(f => {
              const isOpen = selectedFile?.path === f.path
              return (
                <button
                  key={f.path}
                  onClick={() => openFile(f)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                    isOpen
                      ? 'border-lime text-lime bg-lime/10'
                      : 'border-brd text-txt-2 hover:border-brd-2 hover:text-txt bg-surface-2'
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                    <path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {f.path}
                </button>
              )
            })}
          </div>

          {/* Inline file editor */}
          {selectedFile && (
            <div className="border border-brd rounded-xl bg-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-brd bg-surface-2">
                <div>
                  <span className="text-xs font-semibold text-txt font-mono">{selectedFile.path}</span>
                  <span className="ml-2 text-xs text-txt-3">{selectedFile.text}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveFile}
                    disabled={fileSaving || !isFileDirty}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-lime text-bg text-xs font-semibold transition-all cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {fileSaving ? (
                      <svg className="animate-spin" width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25 10" /></svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M13 5l-6 6-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                    Save
                  </button>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="icon-btn"
                    title="Close"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              </div>
              <div className="relative">
                {fileLoading ? (
                  <div className="flex items-center justify-center h-32 text-txt-3 text-sm">Loading…</div>
                ) : (
                  <>
                    <textarea
                      value={fileContent}
                      onChange={e => setFileContent(e.target.value)}
                      spellCheck={false}
                      className="w-full h-[40vh] min-h-[200px] bg-transparent px-4 py-3 font-mono text-sm text-txt leading-relaxed resize-y focus:outline-none"
                    />
                    {isFileDirty && (
                      <span className="absolute top-2.5 right-3 text-[0.65rem] text-amber font-medium select-none">
                        unsaved
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
