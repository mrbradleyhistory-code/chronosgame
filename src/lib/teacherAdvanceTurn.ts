import { supabase } from './supabase'
import type { HexMapData } from './hexUtils'
import { parseHexMapData } from './hexUtils'
import type { Civilization } from '../contexts/StudentContext'
import type { TurnActionSlotRow } from '../types/actions'
import { resolveTurnForGame } from './turnEngine'

function rowToCivilization(row: Record<string, unknown>): Civilization {
  return {
    id: row.id as string,
    game_id: row.game_id as string,
    group_name: row.group_name as string,
    username: row.username as string,
    resources: (row.resources as Record<string, unknown>) ?? {},
    territory: row.territory,
    techs: Array.isArray(row.techs)
      ? (row.techs as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    policies: Array.isArray(row.policies)
      ? (row.policies as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    action_points: typeof row.action_points === 'number' ? row.action_points : 3,
    color: typeof row.color === 'string' ? row.color : '#6366f1',
    ...(row.buildings != null ? { buildings: row.buildings } : {}),
  }
}

export async function advanceGameTurnTeacher(
  gameId: string,
): Promise<{ detail: string } | { ok: true; message: string }> {
  const { data: gameRow, error: gErr } = await supabase
    .from('games')
    .select('hex_map, current_turn, settings')
    .eq('id', gameId)
    .single()

  if (gErr || !gameRow) return { detail: gErr?.message ?? 'Unable to reach game parchment.' }

  const turnNow = typeof gameRow.current_turn === 'number' ? gameRow.current_turn : 1
  const map = parseHexMapData(gameRow.hex_map as unknown)
  if (!map) return { detail: 'Lock a world atlas (hex_map) before advancing centuries.' }

  const { data: civRows, error: cErr } = await supabase
    .from('civilizations')
    .select('*')
    .eq('game_id', gameId)

  if (cErr || !civRows?.length) return { detail: cErr?.message ?? 'No civilisations on record.' }

  const civilizations = (civRows as Record<string, unknown>[]).map(rowToCivilization)

  const { data: queues, error: qErr } = await supabase
    .from('turn_action_slots')
    .select('*')
    .eq('game_id', gameId)
    .eq('turn_number', turnNow)

  if (qErr) return { detail: qErr.message }

  const queueRows = ((queues ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    game_id: r.game_id as string,
    civ_id: r.civ_id as string,
    turn_number: r.turn_number as number,
    slot_index: r.slot_index as number,
    action_type: r.action_type as TurnActionSlotRow['action_type'],
    payload: (r.payload as Record<string, unknown>) ?? {},
    review_status: r.review_status as TurnActionSlotRow['review_status'],
    reviewed_payload: r.reviewed_payload as Record<string, unknown> | null,
    submitted_at: r.submitted_at as string,
  }))

  const unresolved = queueRows.filter((row) => row.review_status === 'submitted')
  if (unresolved.length) {
    return {
      detail: `Still awaiting magistrate rulings — ${unresolved.length} decree(s) have not been judged.`,
    }
  }

  const artefact = resolveTurnForGame({
    map,
    civilizationRows: civilizations,
    settingsUnknown: gameRow.settings,
    queueRows,
    turnNumberBeingResolved: turnNow,
  })

  for (const civ of civilizations) {
    const patch = artefact.civilizationPatches[civ.id]
    if (!patch) continue
    const { error } = await supabase.from('civilizations').update(patch).eq('id', civ.id)
    if (error) return { detail: `Failed updating civilisation (${civ.group_name}): ${error.message}` }
  }

  const ledger = {
    resolved_turn: turnNow,
    action_outcomes: artefact.events,
    slot_audits: artefact.turnEventsJson,
  }

  const { error: tErr } = await supabase.from('turns').insert({
    game_id: gameId,
    turn_number: turnNow,
    century_label: `Century ${turnNow}`,
    events: ledger,
    resolved_at: new Date().toISOString(),
  })

  if (tErr) return { detail: `Turn ledger inscription failed: ${tErr.message}` }

  await supabase.from('turn_action_slots').delete().eq('game_id', gameId).eq('turn_number', turnNow)

  const nextMapPayload = artefact.map as unknown as HexMapData
  const { error: mapErr } = await supabase
    .from('games')
    .update({
      hex_map: nextMapPayload,
      current_turn: turnNow + 1,
    })
    .eq('id', gameId)

  if (mapErr) return { detail: `Could not emboss atlas / advance calendar: ${mapErr.message}` }

  return { ok: true, message: `Century ${turnNow} inscribed; Chronos advances to Century ${turnNow + 1}.` }
}
