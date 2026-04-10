import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import clsx from 'clsx'

type Tab = 'topics' | 'schedules' | 'memory' | 'settings'

const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'topics',
    label: 'Topics',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" stroke="currentColor" strokeWidth="1.3" /><path d="M5 6h6M5 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
  {
    id: 'schedules',
    label: 'Schedules',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5 1.5 2.5 3.7 2.5 6.5c0 1.7.9 3.2 2.3 4.1V12a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-1.4c1.4-.9 2.2-2.4 2.2-4.1C13 3.7 10.5 1.5 8 1.5z" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 14.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
]

interface Props {
  topicsPanel: ReactNode
  schedulesPanel: ReactNode
  memoryPanel: ReactNode
  settingsPanel: ReactNode
}

export function Layout({ topicsPanel, schedulesPanel, memoryPanel, settingsPanel }: Props) {
  const { status, logout } = useStore()
  const [activeTab, setActiveTab] = useState<Tab>('topics')

  const panels: Record<Tab, ReactNode> = {
    topics: topicsPanel,
    schedules: schedulesPanel,
    memory: memoryPanel,
    settings: settingsPanel,
  }

  return (
    <>
      {/* Topbar */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-surface border-b border-brd sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
            <rect x="4" y="4" width="40" height="40" rx="8" stroke="currentColor" strokeWidth="2.5" className="text-lime" fill="none" />
            <circle cx="18" cy="20" r="3" className="fill-lime" />
            <circle cx="30" cy="20" r="3" className="fill-lime" />
            <path d="M16 30 Q24 36 32 30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-lime" fill="none" />
          </svg>
          <span className="font-display font-bold text-base tracking-tight">
            agent<span className="text-lime">.</span>ctrl
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 border border-brd rounded-full font-mono text-[0.72rem] font-medium text-txt-2">
            <span className="w-[7px] h-[7px] rounded-full bg-emerald shadow-[0_0_6px_rgba(52,211,153,0.5)] animate-pulse-dot" />
            <span>{status?.defaultProvider ?? '...'}</span>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-brd text-txt-3 hover:text-txt-2 hover:bg-surface-2 hover:border-brd-2 transition-all cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2M11 11l3-3-3-3M6 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="flex bg-surface border-b border-brd px-3 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 font-medium text-[0.82rem] border-b-2 transition-all cursor-pointer whitespace-nowrap',
              activeTab === t.id
                ? 'text-lime border-lime [&_svg]:opacity-100'
                : 'text-txt-3 border-transparent hover:text-txt-2 [&_svg]:opacity-60'
            )}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main className="max-w-[960px] mx-auto p-4 sm:p-5">
        {panels[activeTab]}
      </main>
    </>
  )
}
