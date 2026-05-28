import { supabase } from './supabase'
import type { HexMapData } from './hexUtils'
import { normalizeHexMap } from './hexUtils'
import { ensureStudentCanSeeMap } from './civPlacement'

async function persistMap(gameId: string, map: HexMapData): Promise<void> {
  const { error: directErr } = await supabase.from('games').update({ hex_map: map }).eq('id', gameId)
  if (!directErr) return

  const { data: rpcRaw, error: rpcErr } = await supabase.rpc('save_hex_map_spawns', {
    p_game_id: gameId,
    p_hex_map: map,
  })

  if (rpcErr) {
    console.warn('Could not persist map spawns:', rpcErr.message)
    return
  }

  const envelope = rpcRaw as { ok?: boolean; error?: string } | null
  if (envelope?.ok === false && envelope.error) {
    console.warn('save_hex_map_spawns rejected:', envelope.error)
  }
}

/** Ask Supabase to bootstrap spawns server-side (no-op if RPC not deployed yet). */
export async function bootstrapMapSpawnsOnServer(gameId: string): Promise<void> {
  const { error } = await supabase.rpc('ensure_hex_map_spawns_in_place', { p_game_id: gameId })
  if (error && !error.message.includes('Could not find the function')) {
    console.warn('ensure_hex_map_spawns_in_place:', error.message)
  }
}

/** Normalize, place civs, repair fog for the viewing student, persist when possible. */
export async function prepareGameMapForPlay(
  gameId: string,
  mapIn: HexMapData,
  civIds: string[],
  focusCivId: string | undefined,
  worldSeed: string,
  canPersist: boolean,
): Promise<HexMapData> {
  await bootstrapMapSpawnsOnServer(gameId)

  const normalized = normalizeHexMap(mapIn)
  const focus = focusCivId ?? civIds[0]
  if (!focus) return normalized

  const { map: prepared, changed } = ensureStudentCanSeeMap(normalized, focus, civIds, worldSeed)
  if (changed && canPersist) await persistMap(gameId, prepared)
  return prepared
}

/** @deprecated use prepareGameMapForPlay */
export async function applyCivSpawnsToGameMap(
  gameId: string,
  map: HexMapData,
  civIds: string[],
  worldSeed: string,
  canPersist: boolean,
  focusCivId?: string,
): Promise<HexMapData> {
  return prepareGameMapForPlay(gameId, map, civIds, focusCivId ?? civIds[0], worldSeed, canPersist)
}
