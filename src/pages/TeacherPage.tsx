import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { CivManager } from '../components/CivManager'
import { MapCanvas } from '../components/MapCanvas'

export default function TeacherPage() {
  const { user, signInWithGoogle, signOut, loading } = useAuth()
  const [activeGameId, setActiveGameId] = useState('')

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <p>Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white">
        <h1 className="text-3xl font-bold">Chronos — Teacher Portal</h1>
        <p className="text-slate-400">Sign in with your Google account to manage games.</p>
        <button
          onClick={signInWithGoogle}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-500 transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold">Teacher Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user.email}</span>
          <button
            onClick={signOut}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden gap-0">
        {/* Left sidebar: management panel */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-slate-700 p-4">
          <h2 className="mb-4 text-lg font-semibold">Civilizations &amp; PINs</h2>
          <CivManager onGameSelect={setActiveGameId} />

          <div className="mt-6 space-y-4">
            {(['Question Sets', 'Review Sessions'] as const).map((section) => (
              <div key={section} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <h2 className="mb-1 font-semibold text-sm">{section}</h2>
                <p className="text-xs text-slate-400">Coming soon.</p>
              </div>
            ))}
          </div>
        </aside>

        {/* Main area: map */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-700 px-4 py-2 flex items-center gap-2">
            <span className="text-sm text-slate-400">World Map</span>
            {!activeGameId && (
              <span className="text-xs text-slate-600">— select a game to view</span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeGameId ? (
              <MapCanvas viewMode="teacher" gameId={activeGameId} />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-600 text-sm">
                No game selected
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
