import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { CombatLogEntry } from '../types/combat'
import { combatLogEntriesFromTurnEvents } from '../lib/combatResolution'
import { supabase } from '../lib/supabase'

// ─── Props ─────────────────────────────────────────────────────────────────────

interface CombatLogProps {
  gameId: string
  civId: string
}

// ─── Sort / filter ─────────────────────────────────────────────────────────────

function battleSortDesc(a: CombatLogEntry, b: CombatLogEntry): number {
  if (b.resolved_turn !== a.resolved_turn) return b.resolved_turn - a.resolved_turn
  return b.slot_id.localeCompare(a.slot_id)
}

// ─── Component ─────────────────────────────────────────────────────────────────

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
    if (n === 0) return 'No battles yet this chronicle.'
    return `${n} battle${n === 1 ? '' : 's'} on record`
  }, [mine.length])

  return (
    <section className="combat-log-panel rounded border border-amber-900/40 bg-slate-900/90 overflow-hidden">
      <header className="combat-log-panel-head px-3 py-2 border-b border-amber-900/35">
        <h2 className="combat-log-title">Field chronicle</h2>
        <p className="combat-log-sub">{subtitle}</p>
      </header>
      <div className="combat-log-body max-h-64 overflow-y-auto px-2 py-3 space-y-2">
        {loadErr && (
          <p className="text-rose-300 text-xs px-1">Cannot read ledger: {loadErr}</p>
        )}
        {!loadErr && mine.length === 0 && (
          <p className="text-slate-500 text-xs italic px-1">Awaiting inscribed conflicts…</p>
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
              className="combat-log-entry rounded-md border border-amber-950/50 bg-black/35 px-2.5 py-2 text-left"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="combat-log-chip text-[0.62rem]">
                  Century {e.resolved_turn} · [{e.q},{e.r}]
                </span>
                <span className={`combat-log-verdict shrink-0 ${victorious ? 'text-emerald-400' : 'text-amber-700'}`}>
                  {victorious ? 'Victory' : 'Defeat'}
                </span>
              </div>
              <p className="combat-log-narr text-[0.72rem] leading-snug opacity-95">{e.narrative}</p>
              <p className="combat-log-metrics text-[0.62rem] mt-1.5 opacity-75">
                Scores {e.attacker_total} vs {e.defender_total} · d20 {e.attacker_roll}/{e.defender_roll} · Casualties —
                swords −{myLossMil}, souls −{myLossPop}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
