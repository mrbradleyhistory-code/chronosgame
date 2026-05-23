import { useCallback, useEffect, useState } from 'react'
import type { HexCell } from '../lib/hexUtils'
import { supabase } from '../lib/supabase'
import { useStudent, type StudentPlayBundle } from '../contexts/StudentContext'
import { StudentLogin } from '../components/StudentLogin'
import { MapCanvas } from '../components/MapCanvas'
import { StatPanel } from '../components/StatPanel'
import { ResourceBar } from '../components/ResourceBar'
import { ActionQueuePanel } from '../components/ActionQueuePanel'

interface PeerBrief {
  id: string
  group_name: string
}

export default function StudentPage() {
  const { civ, logout, pullPlayState } = useStudent()
  const [play, setPlay]       = useState<StudentPlayBundle | null>(null)
  const [syncErr, setSyncErr] = useState<string | null>(null)
  const [pinnedHex, setPinnedHex] = useState<HexCell | null>(null)
  const [peers, setPeers]     = useState<PeerBrief[]>([])

  const hydrate = useCallback(async () => {
    if (!civ) return
    const res = await pullPlayState()
    if ('error' in res) {
      setSyncErr(res.error)
      return
    }
    setSyncErr(null)
    setPlay(res.data)
  }, [civ, pullPlayState])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!civ) return undefined
    const channel = supabase
      .channel(`student-game-sync-${civ.game_id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${civ.game_id}` },
        () => {
          void hydrate()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [civ?.game_id, hydrate])

  useEffect(() => {
    if (!civ) return
    void supabase
      .from('civilizations')
      .select('id, group_name')
      .eq('game_id', civ.game_id)
      .then(({ data }) => {
        if (!data) return
        setPeers(data as PeerBrief[])
      })
  }, [civ?.game_id])

  if (!civ) {
    return <StudentLogin />
  }

  const currentTurn = play?.game.current_turn ?? '?'

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* ── Top header row ───────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-3.5 rounded-full"
            style={{ backgroundColor: civ.color }}
          />
          <h1 className="text-xl font-bold">{civ.group_name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">
            Century {currentTurn}
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 transition-colors"
          >
            Leave
          </button>
        </div>
      </header>

      {syncErr && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-100 text-xs px-4 py-2">
          Herald failed: {syncErr}
        </div>
      )}

      {/* ── Resource bar (trade + luxuries) ─────────────────────────────── */}
      <ResourceBar resources={civ.resources as Record<string, unknown>} />

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden gap-0">
        {/* Map fills most of the screen */}
        <div className="flex-1 overflow-hidden">
          <MapCanvas
            viewMode="student"
            gameId={civ.game_id}
            civId={civ.id}
            onStudentHexPick={setPinnedHex}
          />
        </div>

        {/* Right sidebar: game panels */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-700 p-4 space-y-4 bg-slate-950/70">
          <StatPanel resources={civ.resources as Record<string, unknown>} />

          {play && (
            <ActionQueuePanel
              civilization={play.civ}
              peers={peers}
              currentTurn={play.game.current_turn}
              pinnedHex={pinnedHex}
              queueFromServer={play.queue.map((slot) => ({
                slot_index: slot.slot_index,
                action_type: slot.action_type,
                review_status: slot.review_status,
                payload: slot.payload,
              }))}
              settingsUnknown={play.game.settings}
              onHydrate={hydrate}
            />
          )}
        </aside>
      </main>
    </div>
  )
}
