import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App'
import { AccountsProvider } from './accounts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountsProvider>
      <App />
    </AccountsProvider>
  </StrictMode>,
)
