import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreProvider, useStore } from './store'
import { Login } from './components/Login'
import { Layout } from './components/Layout'
import './index.css'

function Placeholder({ name }: { name: string }) {
  return <div className="text-txt-3 text-center py-12 font-mono text-sm">{name} — coming soon</div>
}

function App() {
  const { isAuthenticated } = useStore()
  if (!isAuthenticated) return <Login />
  return (
    <Layout
      topicsPanel={<Placeholder name="Topics" />}
      schedulesPanel={<Placeholder name="Schedules" />}
      settingsPanel={<Placeholder name="Settings" />}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
)
