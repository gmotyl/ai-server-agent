import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="text-lime text-center p-8 font-display text-2xl">Panel scaffold works</div>
  </StrictMode>,
)
