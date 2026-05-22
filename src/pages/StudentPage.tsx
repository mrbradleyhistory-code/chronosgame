import { useStudent } from '../contexts/StudentContext'
import { StudentLogin } from '../components/StudentLogin'
import { MapCanvas } from '../components/MapCanvas'

export default function StudentPage() {
  const { civ, logout } = useStudent()

  if (!civ) {
    return <StudentLogin />
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-3.5 rounded-full"
            style={{ backgroundColor: civ.color }}
          />
          <h1 className="text-xl font-bold">{civ.group_name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">
            Turn 1
          </span>
          <button
            onClick={logout}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 transition-colors"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden gap-0">
        {/* Map fills most of the screen */}
        <div className="flex-1 overflow-hidden">
          <MapCanvas viewMode="student" gameId={civ.game_id} civId={civ.id} />
        </div>

        {/* Right sidebar: game panels */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-slate-700 p-4 space-y-4">
          {(['Resources', 'Actions', 'Technologies', 'Messages'] as const).map((panel) => (
            <div key={panel} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <h2 className="mb-1 font-semibold text-sm">{panel}</h2>
              <p className="text-xs text-slate-400">Coming soon.</p>
            </div>
          ))}
        </aside>
      </main>
    </div>
  )
}
