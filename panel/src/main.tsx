import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreProvider, useStore } from './store'
import { Login } from './components/Login'
import { Layout } from './components/Layout'
import { TopicList } from './components/TopicList'
import { ScheduleList } from './components/ScheduleList'
import { Memory } from './components/Memory'
import { Settings } from './components/Settings'
import { Toast } from './components/Toast'
import './index.css'

function App() {
  const { isAuthenticated } = useStore()
  if (!isAuthenticated) return <Login />
  return (
    <Layout
      topicsPanel={<TopicList />}
      schedulesPanel={<ScheduleList />}
      memoryPanel={<Memory />}
      settingsPanel={<Settings />}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
      <Toast />
    </StoreProvider>
  </StrictMode>,
)
