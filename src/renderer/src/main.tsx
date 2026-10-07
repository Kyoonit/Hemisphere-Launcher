import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import i18n, { systemLanguage } from './i18n'
import App from './App'
import { AccountsProvider } from './accounts'

// Saved language (Settings > Launcher); 'auto' follows Windows.
window.hemisphere.settings.get().then((s) => i18n.changeLanguage(s.language === 'auto' ? systemLanguage() : s.language))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountsProvider>
      <App />
    </AccountsProvider>
  </StrictMode>,
)
