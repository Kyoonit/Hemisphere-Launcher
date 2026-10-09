/** Preview tab: the time travel (Herald's state at any instant), or what launchers really get now (S11). */
import { useState } from 'react'
import TimeTravel from './TimeTravel'
import OnlineNow from './OnlineNow'

export default function Preview() {
  const [mode, setMode] = useState<'travel' | 'online'>('travel')
  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-gray-800 p-1">
        {(['travel', 'online'] as const).map((m) => (
          <button key={m} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} onClick={() => setMode(m)}>
            {m === 'travel' ? 'Time travel' : 'Online now'}
          </button>
        ))}
      </div>
      {mode === 'travel' ? <TimeTravel /> : <OnlineNow />}
    </div>
  )
}
