import { supabase } from './supabase'
import type { TurnActionSlotRow } from '../types/actions'

function rowFromRpc(r: Record<string, unknown>): TurnActionSlotRow {
  return {
    id: r.id as string,
    game_id: r.game_id as string,
    civ_id: r.civ_id as string,
    turn_number:
      typeof r.turn_number === 'number' ? r.turn_number : Number.parseInt(String(r.turn_number), 10) || 0,
    slot_index: typeof r.slot_index === 'number' ? r.slot_index : Number.parseInt(String(r.slot_index), 10) || 0,
    action_type: r.action_type as TurnActionSlotRow['action_type'],
    payload: (r.payload as Record<string, unknown>) ?? {},
    review_status: r.review_status as TurnActionSlotRow['review_status'],
    reviewed_payload:
      r.reviewed_payload != null && typeof r.reviewed_payload === 'object'
        ? (r.reviewed_payload as Record<string, unknown>)
        : null,
    submitted_at: typeof r.submitted_at === 'string' ? r.submitted_at : '',
  }
}

/** Security-definer RPC on Supabase (see supabase-turn-engine.sql) — reliable vs table RLS edge cases */
export async function fetchTeacherTurnSlotsForGameTurn(
  gameId: string,
  turnNumber: number,
): Promise<{ error: string | null; rows: TurnActionSlotRow[] }> {
  const { data, error } = await supabase.rpc('teacher_list_turn_slots', {
    p_game_id: gameId,
    p_turn: turnNumber,
  })

  if (error) return { error: error.message, rows: [] }

  const arr: unknown[] = Array.isArray(data) ? (data as unknown[]) : []

  const rows = arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
    .map(rowFromRpc)

  return { error: null, rows }
}
