import { useState } from 'react'
import type { Profile } from '@herald/api'
import { WindowButtons } from '../components/TitleBar'

/** Not a tab: shown instead of everything while nobody is signed in. */
export default function SignIn({ onSignedIn, staging }: { onSignedIn(me: Profile): void; staging: boolean }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await window.herald.session.signIn(name, code)
    setBusy(false)
    if (res.ok) onSignedIn(res.data)
    else setError(res.error)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="drag flex h-[52px] shrink-0 items-center gap-3 pl-4">
        <div className="flex items-center gap-2 text-[17px] font-bold text-white">Herald</div>
        {staging && <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2 text-[10.5px] font-bold tracking-wider text-amber-400">STAGING</span>}
        <div className="ml-auto flex h-full">
          <WindowButtons />
        </div>
      </div>
      <div className="grid flex-1 place-items-center bg-[radial-gradient(ellipse_at_top,#173524,#111827_62%)]">
        <form
          className="card w-[370px] p-7"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="mb-2 flex justify-center">
            <span className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-green-400 to-green-600 text-2xl font-extrabold text-gray-950">H</span>
          </div>
          <h1 className="text-center text-2xl font-extrabold text-white">Herald</h1>
          <p className="mb-5 text-center text-sm text-gray-400">Hemisphere SMP staff</p>
          <label className="label">Name</label>
          <input className="field mb-3" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <label className="label">Code</label>
          <input className="field font-mono" type="password" value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <p className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>}
          <button className="btn btn-primary mt-5 w-full justify-center" disabled={busy || !name.trim() || !code.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="mt-3 text-center text-xs text-gray-400">
            Herald remembers you on this computer for 30 days.
            <br />
            Lost your code? Ask Liable or Kyonit for a new one.
          </p>
        </form>
      </div>
    </div>
  )
}
