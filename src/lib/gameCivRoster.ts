import { supabase } from './supabase'

export interface CivRosterEntry {
  id: string
  group_name: string
  color: string
}

/** Teachers read civilizations via RLS; students use security-definer roster RPC. */
export async function fetchGameCivRoster(gameId: string): Promise<CivRosterEntry[]> {
  const { data: direct, error: directErr } = await supabase
    .from('civilizations')
    .select('id, group_name, color')
    .eq('game_id', gameId)
    .order('group_name')

  if (!directErr && direct && direct.length > 0) {
    return direct as CivRosterEntry[]
  }

  const { data: rpcRaw, error: rpcErr } = await supabase.rpc('list_game_civ_roster', {
    p_game_id: gameId,
  })

  if (rpcErr || !Array.isArray(rpcRaw)) return []

  return (rpcRaw as unknown[])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
    .map((row) => ({
      id: String(row.id),
      group_name: String(row.group_name ?? ''),
      color: String(row.color ?? '#6366f1'),
    }))
}
