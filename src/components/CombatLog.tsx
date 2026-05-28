import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { CombatLogEntry } from '../types/combat'
import { combatLogEntriesFromTurnEvents } from '../lib/combatResolution'
import { supabase } from '../lib/supabase'

interface CombatLogProps {
  gameId: string
  civId: string
}

function battleSortDesc(a: CombatLogEntry, b: CombatLogEntry): number {
  if (b.resolved_turn !== a.resolved_turn) return b.resolved_turn - a.resolved_turn
  return b.slot_id.localeCompare(a.slot_id)
}

export function CombatLog({ gameId, civId }: CombatLogProps): ReactElement {
  const [mine, setMine] = useState<CombatLogEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const hydrate = useCallback(async () => {
    const { data, error } = await supabase
      .from('turns')
      .select('events')
      .eq('game_id', gameId)
      .order('turn_number', { ascending: false })
      .limit(60)

    if (error) {
      setLoadErr(error.message)
      return
    }
    setLoadErr(null)

    const flattened: CombatLogEntry[] = []
    for (const row of data ?? []) {
      flattened.push(...combatLogEntriesFromTurnEvents((row as { events: unknown }).events))
    }

    flattened.sort(battleSortDesc)

    const forCiv = flattened.filter((e) => e.attacker_civ_id === civId || e.defender_civ_id === civId)
    setMine(forCiv)
  }, [gameId, civId])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const channel = supabase
      .channel(`student-combat-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'turns',
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          void hydrate()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        () => {
          void hydrate()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [gameId, hydrate])

  const subtitle = useMemo(() => {
    const n = mine.length
    if (n === 0) return 'No battles recorded yet.'
    return `${n} battle${n === 1 ? '' : 's'} involving your civilization`
  }, [mine.length])

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/90 overflow-hidden">
      <header className="px-3 py-2 border-b border-slate-700">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Battle log</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </header>
      <div className="max-h-56 overflow-y-auto px-2 py-2 space-y-2">
        {loadErr && (
          <p className="text-rose-300 text-xs px-1">Could not load battles: {loadErr}</p>
        )}
        {!loadErr && mine.length === 0 && (
          <p className="text-slate-500 text-xs px-1 py-2">Battles will appear here after the teacher advances the turn.</p>
        )}
        {mine.map((e) => {
          const iAttacked = e.attacker_civ_id === civId
          const victorious =
            (e.winner === 'attacker' && iAttacked) || (e.winner === 'defender' && !iAttacked)
          const myLossMil = iAttacked ? e.attacker_military_lost : e.defender_military_lost
          const myLossPop = iAttacked ? e.attacker_population_lost : e.defender_population_lost

          return (
            <article
              key={`${e.resolved_turn}-${e.slot_id}`}
              className="rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-2 text-left"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[11px] text-slate-500">
                  Century {e.resolved_turn} · hex ({e.q}, {e.r})
                </span>
                <span className={`text-[11px] font-semibold shrink-0 ${victorious ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {victorious ? 'Victory' : 'Defeat'}
                </span>
              </div>
              <p className="text-sm text-slate-200 leading-snug">{e.narrative}</p>
              <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                Scores {e.attacker_total} vs {e.defender_total} · d20 {e.attacker_roll}/{e.defender_roll} · Losses: −{myLossMil}{' '}
                military, −{myLossPop} population
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
