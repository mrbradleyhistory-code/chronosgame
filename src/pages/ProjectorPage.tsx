import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { MapCanvas } from '../components/MapCanvas'

export default function ProjectorPage() {
  const [gameId, setGameId] = useState<string | null>(null)
  const [gameName, setGameName] = useState('')
  const [turn, setTurn] = useState(1)

  useEffect(() => {
    supabase
      .from('games')
      .select('id, name, current_turn')
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setGameId(data.id)
          setGameName(data.name)
          setTurn(data.current_turn)
        }
      })
  }, [])

  const century = turn === 1 ? '3000 BCE' : `${3000 - (turn - 1) * 100} BCE`

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-wide">
          Chronos{gameName ? ` — ${gameName}` : ''}
        </h1>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">
          Turn {turn} — {century}
        </span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {gameId ? (
          <MapCanvas viewMode="projector" gameId={gameId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-600 text-sm">
            No active game found. Start a game from the Teacher portal.
          </div>
        )}
      </main>
    </div>
  )
}
