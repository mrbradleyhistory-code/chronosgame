import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HexCell } from '../lib/hexUtils'
import { supabase } from '../lib/supabase'
import { useStudent, type StudentPlayBundle } from '../contexts/StudentContext'
import { StudentLogin } from '../components/StudentLogin'
import { MapCanvas } from '../components/MapCanvas'
import { StatPanel } from '../components/StatPanel'
import { ResourceBar } from '../components/ResourceBar'
import { ActionQueuePanel } from '../components/ActionQueuePanel'
import { CombatLog } from '../components/CombatLog'
import { fetchGameCivRoster } from '../lib/gameCivRoster'
import { bootstrapMapSpawnsOnServer } from '../lib/ensureGameMapSpawns'
import { listValidExpandTargets } from '../lib/civPlacement'
import { hexKey, type HexMapData } from '../lib/hexUtils'

interface PeerBrief {
  id: string
  group_name: string
}

export default function StudentPage() {
  const { civ, logout, pullPlayState } = useStudent()
  const [play, setPlay]       = useState<StudentPlayBundle | null>(null)
  const [syncErr, setSyncErr] = useState<string | null>(null)
  const [pinnedHex, setPinnedHex] = useState<HexCell | null>(null)
  const [mapData, setMapData] = useState<HexMapData | null>(null)
  const [needsExpandTarget, setNeedsExpandTarget] = useState(false)
  const [peers, setPeers]     = useState<PeerBrief[]>([])
  const [mapRev, setMapRev]   = useState(0)

  const onStudentMapReady = useCallback((map: HexMapData) => {
    setMapData(map)
  }, [])

  const expandTargets = useMemo(
    () => (mapData && civ ? listValidExpandTargets(mapData, civ.id) : []),
    [mapData, civ],
  )

  const expandTargetKeys = useMemo(() => {
    if (!needsExpandTarget) return undefined
    return new Set(expandTargets.map((c) => hexKey(c.q, c.r)))
  }, [needsExpandTarget, expandTargets])

  const handleHexPick = useCallback(
    (cell: HexCell) => {
      if (needsExpandTarget) {
        const valid = expandTargets.some((t) => t.q === cell.q && t.r === cell.r)
        if (!valid) return
      }
      setPinnedHex(cell)
    },
    [needsExpandTarget, expandTargets],
  )

  useEffect(() => {
    if (!needsExpandTarget || !pinnedHex) return
    if (!expandTargets.some((t) => t.q === pinnedHex.q && t.r === pinnedHex.r)) {
      setPinnedHex(null)
    }
  }, [needsExpandTarget, expandTargets, pinnedHex])

  const hydrate = useCallback(async () => {
    if (!civ) return
    const res = await pullPlayState()
    if ('error' in res) {
      setSyncErr(res.error)
      return
    }
    setSyncErr(null)
    setPlay(res.data)
    await bootstrapMapSpawnsOnServer(civ.game_id)
    setMapRev((v) => v + 1)
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
    void fetchGameCivRoster(civ.game_id).then((rows) => {
      if (rows.length > 0) setPeers(rows.map((r) => ({ id: r.id, group_name: r.group_name })))
    })
  }, [civ?.game_id])

  if (!civ) {
    return <StudentLogin />
  }

  const currentTurn = play?.game.current_turn ?? '?'

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans antialiased">
      <header className="flex items-center justify-between gap-4 border-b border-slate-700 px-5 py-3 shrink-0 bg-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="h-3 w-3 rounded-full shrink-0 ring-2 ring-slate-600"
            style={{ backgroundColor: civ.color }}
          />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{civ.group_name}</h1>
            <p className="text-xs text-slate-400">Student view · Century {currentTurn}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
        >
          Sign out
        </button>
      </header>

      {syncErr && (
        <div className="bg-rose-950/50 border-b border-rose-900 text-rose-100 text-sm px-5 py-2">
          Could not sync game state: {syncErr}
        </div>
      )}

      <ResourceBar resources={civ.resources as Record<string, unknown>} />

      <main className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <MapCanvas
            key={`${civ.game_id}-${mapRev}`}
            viewMode="student"
            gameId={civ.game_id}
            civId={civ.id}
            playerCiv={{ id: civ.id, color: civ.color, group_name: civ.group_name }}
            onStudentHexPick={handleHexPick}
            onStudentMapReady={onStudentMapReady}
            onMapLoaded={setMapData}
            expandTargetKeys={expandTargetKeys}
          />
        </div>

        <aside className="w-[22rem] shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-950/80">
          <div className="p-3 space-y-3">
            <StatPanel resources={civ.resources as Record<string, unknown>} />
            <CombatLog gameId={civ.game_id} civId={civ.id} />

            {play && (
              <ActionQueuePanel
                civilization={play.civ}
                peers={peers}
                currentTurn={play.game.current_turn}
                pinnedHex={pinnedHex}
                expandTargets={expandTargets}
                onExpandModeChange={setNeedsExpandTarget}
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
          </div>
        </aside>
      </main>
    </div>
  )
}
