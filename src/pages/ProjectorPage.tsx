export default function ProjectorPage() {
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <h1 className="text-2xl font-bold tracking-wide">Chronos Game</h1>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">
          Turn 1 — 3000 BCE
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-5xl space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <p className="text-lg text-slate-400">Projector view — placeholder.</p>
            <p className="mt-2 text-sm text-slate-600">
              This screen will display the game map, turn events, and live scoreboard.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {['Map', 'Turn Events', 'Scoreboard'].map((panel) => (
              <div key={panel} className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="font-semibold">{panel}</p>
                <p className="mt-1 text-xs text-slate-500">Coming soon</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
