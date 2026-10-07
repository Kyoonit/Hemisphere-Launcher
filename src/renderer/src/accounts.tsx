import { createContext, useContext, useEffect, useState } from 'react'
import type { AccountInfo, AccountsState } from '@shared/auth'

interface AccountsValue {
  state: AccountsState | null
  active: AccountInfo | null
}

const AccountsContext = createContext<AccountsValue>({ state: null, active: null })

/** Keeps the account list in sync with the main process. */
export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccountsState | null>(null)
  useEffect(() => {
    window.hemisphere.auth.getState().then(setState)
    return window.hemisphere.auth.onChange(setState)
  }, [])
  const active = state?.accounts.find((a) => a.id === state.activeId) ?? null
  return <AccountsContext.Provider value={{ state, active }}>{children}</AccountsContext.Provider>
}

export const useAccounts = () => useContext(AccountsContext)

export const headUrl = (id: string, px: number) => `https://mc-heads.net/avatar/${id}/${px}`
