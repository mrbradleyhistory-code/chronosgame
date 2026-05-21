import { useState } from 'react'

export default function StudentPage() {
  const [step, setStep] = useState<'join' | 'game'>('join')
  const [pin, setPin] = useState('')
  const [groupName, setGroupName] = useState('')

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    // TODO: validate PIN against Supabase civilizations table
    setStep('game')
  }

  if (step === 'join') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white px-4">
        <h1 className="text-3xl font-bold">Join Game</h1>
        <form onSubmit={handleJoin} className="flex w-full max-w-sm flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Group name</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Athens"
              required
              className="w-full rounded-lg bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">PIN</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              placeholder="••••"
              required
              className="w-full rounded-lg bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 py-2 font-semibold hover:bg-indigo-500 transition-colors"
          >
            Join
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <h1 className="text-xl font-bold">{groupName || 'Your Civilization'}</h1>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">Turn 1</span>
      </header>

      <main className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {['Resources', 'Actions', 'Technologies', 'Messages'].map((panel) => (
            <div key={panel} className="rounded-xl border border-slate-700 bg-slate-800 p-6">
              <h2 className="mb-2 text-lg font-semibold">{panel}</h2>
              <p className="text-sm text-slate-400">Placeholder — coming soon.</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
