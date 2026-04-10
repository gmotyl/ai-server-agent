import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { showToast } from './Toast'

export function Settings() {
  const { status, providers, refreshStatus } = useStore()
  const [defaultProvider, setDefaultProvider] = useState(status?.defaultProvider ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api<unknown>('PUT', '/settings', { defaultProvider })
      showToast('Settings saved')
      await refreshStatus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-display font-bold text-xl tracking-tight">Settings</h2>
      </div>

      <div className="flex flex-col gap-4">
        {/* Editable settings */}
        <div className="bg-surface border border-brd rounded-[10px] p-4">
          <div className="flex items-center justify-between py-2.5">
            <div>
              <div className="font-medium text-[0.88rem]">Default Provider</div>
              <div className="text-[0.75rem] text-txt-3 mt-0.5">
                Used when no provider is specified for a topic or schedule
              </div>
            </div>
            <select
              className="form-select"
              value={defaultProvider}
              onChange={e => setDefaultProvider(e.target.value)}
            >
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Read-only info */}
        <div className="bg-surface border border-brd rounded-[10px] p-4">
          <div className="flex items-center justify-between py-2.5">
            <span className="font-medium text-[0.88rem]">Poll Timeout</span>
            <span className="font-mono text-[0.82rem] text-txt-2">{status?.pollTimeout ?? 55}s</span>
          </div>

          <div className="border-t border-brd" />

          <div className="flex items-center justify-between py-2.5">
            <span className="font-medium text-[0.88rem]">Configured Providers</span>
            <div className="flex gap-1.5 flex-wrap">
              {providers.length > 0 ? providers.map(p => (
                <span key={p} className="font-mono text-[0.75rem] font-medium px-2.5 py-0.5 rounded-md bg-surface-3 text-txt-2 border border-brd">
                  {p}
                </span>
              )) : (
                <span className="font-mono text-[0.82rem] text-txt-3">None</span>
              )}
            </div>
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

        <div>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </section>
  )
}
