import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { parseCron, buildCron, getDayLabel } from '../lib/cron'
import { showToast } from './Toast'
import type { Schedule } from '../types'
import clsx from 'clsx'

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface Props {
  schedule?: Schedule
  onDone: () => void
  onCancel: () => void
}

export function ScheduleForm({ schedule, onDone, onCancel }: Props) {
  const isEdit = !!schedule
  const { providers, status } = useStore()
  const cron = parseCron(schedule?.cron || '0 8 * * *')

  const [name, setName] = useState(schedule?.name || '')
  const [hour, setHour] = useState(cron.hour)
  const [minute, setMinute] = useState(cron.minute)
  const [days, setDays] = useState<number[]>(cron.days)
  const [provider, setProvider] = useState(schedule?.provider || '')
  const [workdir, setWorkdir] = useState(schedule?.workdir || '/git')
  const [prompt, setPrompt] = useState(schedule?.prompt || '')
  const [saving, setSaving] = useState(false)

  const toggleDay = (d: number) => {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b))
  }

  const save = async () => {
    if (!name.trim() || !prompt.trim()) { showToast('Name and prompt are required'); return }
    if (days.length === 0) { showToast('Select at least one day'); return }

    setSaving(true)
    const body = {
      name: name.trim(),
      cron: buildCron(minute, hour, days),
      prompt: prompt.trim(),
      provider: provider || null,
      workdir: workdir.trim(),
      topic_name: `Scheduled: ${name.trim()}`,
    }

    try {
      if (isEdit) {
        await api<unknown>('PUT', `/schedules/${encodeURIComponent(schedule!.name)}`, body)
        showToast('Schedule updated')
      } else {
        await api<unknown>('POST', '/schedules', body)
        showToast('Schedule created')
      }
      onDone()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Build minute options aligned to heartbeat interval
  const hbInterval = status?.heartbeatInterval ?? 30
  const minSteps: number[] = []
  for (let m = 0; m < 60; m += hbInterval) minSteps.push(m)
  // Include current value if editing a schedule with a non-aligned minute
  if (!minSteps.includes(minute)) minSteps.push(minute)
  minSteps.sort((a, b) => a - b)

  return (
    <div className="bg-surface border border-brd rounded-[14px] p-5 mt-4 animate-fade-up">
      <h3 className="font-display font-bold text-[1.05rem] mb-5">
        {isEdit ? 'Edit Schedule' : 'New Scheduled Task'}
      </h3>

      {/* Name */}
      <div className="form-row">
        <span className="form-label">Name</span>
        <input
          className="form-input"
          value={name}
          onChange={e => setName(e.target.value)}
          readOnly={isEdit}
          placeholder="my-task"
          style={isEdit ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        />
      </div>

      {/* Time */}
      <div className="form-row">
        <span className="form-label">Time</span>
        <div className="inline-flex items-center gap-0.5 bg-bg border border-brd rounded-lg px-2 py-1">
          <select
            value={hour}
            onChange={e => setHour(Number(e.target.value))}
            className="bg-transparent border-none text-txt font-mono text-[0.9rem] font-semibold w-[42px] text-center cursor-pointer focus:outline-none"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
            ))}
          </select>
          <span className="text-lime font-mono font-bold text-base">:</span>
          <select
            value={minute}
            onChange={e => setMinute(Number(e.target.value))}
            className="bg-transparent border-none text-txt font-mono text-[0.9rem] font-semibold w-[42px] text-center cursor-pointer focus:outline-none"
          >
            {minSteps.map(m => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Days */}
      <div className="form-row">
        <span className="form-label">Days</span>
        <div className="flex items-center flex-wrap gap-1.5">
          <div className="flex gap-1.5">
            {DAY_LABELS.map((label, i) => (
              <div
                key={i}
                onClick={() => toggleDay(i + 1)}
                className={clsx(
                  'w-[34px] h-[34px] rounded-full flex items-center justify-center',
                  'font-mono text-[0.68rem] font-semibold cursor-pointer border-[1.5px] transition-all select-none',
                  days.includes(i + 1)
                    ? 'bg-lime text-bg border-lime shadow-[0_0_10px_var(--color-lime-dim)]'
                    : 'bg-surface-2 text-txt-3 border-brd hover:border-lime'
                )}
              >
                {label}
              </div>
            ))}
          </div>
          <span className="font-mono text-[0.7rem] text-txt-3 ml-1">{getDayLabel(days)}</span>
        </div>
      </div>

      {/* Provider */}
      <div className="form-row">
        <span className="form-label">Provider</span>
        <select
          className="form-select w-[180px]"
          value={provider}
          onChange={e => setProvider(e.target.value)}
        >
          <option value="">Default ({status?.defaultProvider || 'claude'})</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Workdir */}
      <div className="form-row">
        <span className="form-label">Workdir</span>
        <input
          className="form-input"
          value={workdir}
          onChange={e => setWorkdir(e.target.value)}
          placeholder="/git/project"
        />
      </div>

      {/* Prompt */}
      <div className="form-row">
        <span className="form-label top">Prompt</span>
        <textarea
          className="form-textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder="What should the agent do?"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-4 pt-4 border-t border-brd">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
        </button>
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </div>
  )
}
