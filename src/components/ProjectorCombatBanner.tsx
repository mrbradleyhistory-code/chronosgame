import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { CombatLogEntry } from '../types/combat'
import { combatLogEntriesFromTurnEvents } from '../lib/combatResolution'
import { supabase } from '../lib/supabase'

interface ProjectorCombatBannerProps {
  gameId: string
}

function battleSortDesc(a: CombatLogEntry, b: CombatLogEntry): number {
  if (b.resolved_turn !== a.resolved_turn) return b.resolved_turn - a.resolved_turn
  return b.slot_id.localeCompare(a.slot_id)
}

export function ProjectorCombatBanner({ gameId }: ProjectorCombatBannerProps): ReactElement | null {
  const [recent, setRecent] = useState<CombatLogEntry[]>([])
  const [pulseKey, setPulseKey] = useState(0)

  const hydrate = useCallback(async () => {
    const { data } = await supabase
      .from('turns')
      .select('events')
      .eq('game_id', gameId)
      .order('turn_number', { ascending: false })
      .limit(8)

    const flat: CombatLogEntry[] = []
    for (const row of data ?? []) {
      flat.push(...combatLogEntriesFromTurnEvents((row as { events: unknown }).events))
    }
    flat.sort(battleSortDesc)
    setRecent(flat.slice(0, 8))
  }, [gameId])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const channel = supabase
      .channel(`projector-combat-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'turns',
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const events = (payload.new as { events?: unknown }).events
          const fresh = combatLogEntriesFromTurnEvents(events)
          if (fresh.length) {
            fresh.sort(battleSortDesc)
            setRecent((prev) => {
              const byKey = new Map<string, CombatLogEntry>()
              for (const e of [...fresh, ...prev]) {
                const k = `${e.resolved_turn}|${e.slot_id}`
                if (!byKey.has(k)) byKey.set(k, e)
              }
              const merged = [...byKey.values()].sort(battleSortDesc)
              return merged.slice(0, 8)
            })
            setPulseKey((k) => k + 1)
          } else {
            void hydrate()
          }
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

  if (!recent.length) return null

  const [featured, ...rest] = recent

  return (
    <section key={pulseKey} className="projector-combat-strip shrink-0 z-10 border-y border-amber-600/30">
      <div className="projector-combat-strip-inner px-4 py-3 flex gap-4 overflow-x-auto">
        <article className="projector-battle-card projector-battle-card--hero projector-battle-pulse min-w-[min(100%,28rem)] flex-[1_1_auto]">
          <p className="projector-battle-eyebrow">The chronicle cries — War!</p>
          <h3 className="projector-battle-headline">{featured.attacker_name} vs {featured.defender_name}</h3>
          <p className="projector-battle-sub">
            [{featured.q},{featured.r}] · {featured.defender_hex_terrain}{' '}
            <span className="opacity-75">
              ({featured.attacker_total} vs {featured.defender_total}) — d20 {featured.attacker_roll} /{' '}
              {featured.defender_roll}
            </span>
          </p>
          <p className="projector-battle-verdict">{featured.winner === 'attacker' ? featured.attacker_name : featured.defender_name} carries the hour.</p>
          <p className="projector-battle-prose">&ldquo;{featured.narrative}&rdquo;</p>
        </article>

        {rest.map((e) => (
          <article
            key={`${e.resolved_turn}-${e.slot_id}`}
            className="projector-battle-card min-w-[14rem] max-w-[18rem] flex-none"
          >
            <p className="projector-battle-eyebrow text-[0.6rem]">Century {e.resolved_turn}</p>
            <h4 className="projector-battle-mini-title">
              {e.attacker_name} · {e.defender_name}
            </h4>
            <p className="projector-battle-mini-scores">{e.attacker_total} vs {e.defender_total}</p>
            <p className="projector-battle-mini-narr">{e.narrative}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
