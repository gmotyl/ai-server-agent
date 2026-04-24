import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { showToast } from './Toast'
import type { ProviderDetail, ProvidersResponse } from '../types'

const DOC_URL =
  'https://github.com/gmotyl/ai-server-agent/blob/main/docs/adding-docker-provider.md'

interface ProviderFormState {
  name: string
  dispatcher: string
  extra: string
}

const BLANK_FORM: ProviderFormState = { name: '', dispatcher: 'claude', extra: '' }

function extraFieldHint(dispatcher: string): { label: string; placeholder: string; required: boolean } {
  switch (dispatcher) {
    case 'opencode':
      return { label: 'Model', placeholder: 'opencode/minimax-m2.5-free', required: true }
    case 'claude':
      return { label: 'Extra flags', placeholder: '--model claude-haiku-4-5 (optional)', required: false }
    case 'qwen':
      return { label: 'Extra flags', placeholder: '--model qwen3-coder (optional)', required: false }
    default:
      return { label: 'Extra args', placeholder: 'Extra positional arg passed to docker-provider.sh', required: false }
  }
}

export function Settings() {
  const { status, refreshStatus } = useStore()
  const [defaultProvider, setDefaultProvider] = useState(status?.defaultProvider ?? '')
  const [savingDefault, setSavingDefault] = useState(false)

  const [providers, setProviders] = useState<ProviderDetail[]>([])
  const [preconfigured, setPreconfigured] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<ProviderFormState>(BLANK_FORM)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<ProvidersResponse>('GET', '/providers')
      setProviders(data.providers)
      setPreconfigured(data.preconfiguredDispatchers)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProviders() }, [loadProviders])
  useEffect(() => { setDefaultProvider(status?.defaultProvider ?? '') }, [status?.defaultProvider])

  const saveDefault = async () => {
    setSavingDefault(true)
    try {
      await api<unknown>('PUT', '/settings', { defaultProvider })
      showToast('Default provider saved')
      await refreshStatus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingDefault(false)
    }
  }

  const openAdd = () => {
    setEditingName(null)
    setForm(BLANK_FORM)
    setShowForm(true)
  }

  const openEdit = (p: ProviderDetail) => {
    setEditingName(p.name)
    setForm({ name: p.name, dispatcher: p.dispatcher, extra: p.extra })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingName(null)
    setForm(BLANK_FORM)
  }

  const submitForm = async () => {
    if (!form.name.trim()) { showToast('Name is required'); return }
    if (!/^[A-Za-z0-9_-]+$/.test(form.name)) { showToast('Name: letters, digits, _ or - only'); return }
    const hint = extraFieldHint(form.dispatcher)
    if (hint.required && !form.extra.trim()) { showToast(`${hint.label} is required for ${form.dispatcher}`); return }

    setSavingProvider(true)
    try {
      if (editingName) {
        await api<unknown>('PUT', `/providers/${encodeURIComponent(editingName)}`, {
          dispatcher: form.dispatcher,
          extra: form.extra.trim(),
        })
        showToast(`Updated "${editingName}"`)
      } else {
        await api<unknown>('POST', '/providers', {
          name: form.name.trim(),
          dispatcher: form.dispatcher,
          extra: form.extra.trim(),
        })
        showToast(`Added "${form.name.trim()}"`)
      }
      closeForm()
      await Promise.all([loadProviders(), refreshStatus()])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingProvider(false)
    }
  }

  const remove = async (name: string) => {
    if (!confirm(`Delete provider "${name}"?`)) return
    try {
      await api<unknown>('DELETE', `/providers/${encodeURIComponent(name)}`)
      showToast(`Deleted "${name}"`)
      await Promise.all([loadProviders(), refreshStatus()])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const hint = extraFieldHint(form.dispatcher)
  const dispatcherWarn = form.dispatcher && !preconfigured.includes(form.dispatcher)

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Settings</h2>
      </div>

      <div className="flex flex-col gap-4">
        <div className="bg-surface border border-brd rounded-[10px] p-4">
          <div className="flex items-center justify-between py-2.5">
            <div>
              <div className="font-medium text-[0.88rem]">Default Provider</div>
              <div className="text-[0.75rem] text-txt-3 mt-0.5">
                Used when no provider is specified for a topic or schedule
              </div>
            </div>
            <div className="flex gap-2">
              <select
                className="form-select"
                value={defaultProvider}
                onChange={e => setDefaultProvider(e.target.value)}
              >
                {providers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button onClick={saveDefault} disabled={savingDefault} className="btn-primary">
                {savingDefault ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-brd rounded-[10px] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium text-[0.88rem]">Providers</div>
              <div className="text-[0.75rem] text-txt-3 mt-0.5">
                Each provider wires a PROVIDER_CMD_&lt;name&gt; line in agent.conf
              </div>
            </div>
            {!showForm && (
              <button onClick={openAdd} className="btn-primary">+ Add provider</button>
            )}
          </div>

          {loading ? (
            <div className="text-[0.82rem] text-txt-3">Loading…</div>
          ) : (
            <div className="flex flex-col gap-2">
              {providers.length === 0 && !showForm && (
                <div className="text-[0.82rem] text-txt-3">No providers configured yet.</div>
              )}
              {providers.map(p => (
                <div key={p.name} className="border border-brd rounded-md px-3 py-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-[0.84rem]">{p.name}</span>
                        <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-surface-3 text-txt-2">
                          {p.dispatcher}
                        </span>
                        {p.extra && (
                          <span className="font-mono text-[0.7rem] text-txt-3 truncate">{p.extra}</span>
                        )}
                      </div>
                      {p.warning && (
                        <div className="text-[0.72rem] text-amber-400 mt-1">
                          ⚠ {p.warning.split(' — ')[0]}. See{' '}
                          <a href={DOC_URL} target="_blank" rel="noreferrer" className="underline">
                            adding-docker-provider.md
                          </a>.
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button className="icon-btn" onClick={() => openEdit(p)} title="Edit">Edit</button>
                      <button className="icon-btn danger" onClick={() => remove(p.name)} title="Delete">Delete</button>
                    </div>
                  </div>
                </div>
              ))}

              {showForm && (
                <div className="border border-brd-2 rounded-md px-3 py-3 bg-surface-2">
                  <div className="text-[0.82rem] font-semibold mb-2">
                    {editingName ? `Edit "${editingName}"` : 'Add provider'}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.72rem] text-txt-3">Name</span>
                      <input
                        className="form-input"
                        value={form.name}
                        disabled={!!editingName}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="e.g. claude-haiku"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.72rem] text-txt-3">Dispatcher</span>
                      <select
                        className="form-select"
                        value={form.dispatcher}
                        onChange={e => setForm({ ...form, dispatcher: e.target.value })}
                      >
                        {preconfigured.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {dispatcherWarn && (
                        <div className="text-[0.72rem] text-amber-400">
                          ⚠ "{form.dispatcher}" is not baked into the Docker image. You'll need to edit
                          docker/Dockerfile and bin/docker-provider.sh, then rebuild. See{' '}
                          <a href={DOC_URL} target="_blank" rel="noreferrer" className="underline">
                            adding-docker-provider.md
                          </a>.
                        </div>
                      )}
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.72rem] text-txt-3">
                        {hint.label}{hint.required ? ' *' : ''}
                      </span>
                      <input
                        className="form-input"
                        value={form.extra}
                        onChange={e => setForm({ ...form, extra: e.target.value })}
                        placeholder={hint.placeholder}
                      />
                    </label>
                    <div className="flex gap-2 mt-1">
                      <button onClick={submitForm} disabled={savingProvider} className="btn-primary">
                        {savingProvider ? 'Saving…' : editingName ? 'Save changes' : 'Add'}
                      </button>
                      <button onClick={closeForm} className="btn-ghost">Cancel</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-surface border border-brd rounded-[10px] p-4">
          <div className="flex items-center justify-between py-2.5">
            <span className="font-medium text-[0.88rem]">Poll Timeout</span>
            <span className="font-mono text-[0.82rem] text-txt-2">{status?.pollTimeout ?? 55}s</span>
          </div>
          <div className="border-t border-brd" />
          <div className="flex items-center justify-between py-2.5">
            <span className="font-medium text-[0.88rem]">Active Topics</span>
            <span className="font-mono text-[0.82rem] text-txt-2">{status?.topicCount ?? 0}</span>
          </div>
          <div className="border-t border-brd" />
          <div className="flex items-center justify-between py-2.5">
            <span className="font-medium text-[0.88rem]">Scheduled Tasks</span>
            <span className="font-mono text-[0.82rem] text-txt-2">{status?.scheduleCount ?? 0}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
