import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { HeraldBridge } from '@herald/api'
import './styles.css'
import App from './App'

declare global {
  interface Window {
    herald: HeraldBridge
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
