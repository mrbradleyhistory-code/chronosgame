/** One ATTACK verdict stored on `turns.events.combat_log` for projector + student Chronicle. */

export interface CombatLogEntry {
  slot_id: string
  resolved_turn: number
  q: number
  r: number
  defender_hex_terrain: string

  attacker_civ_id: string
  defender_civ_id: string
  attacker_name: string
  defender_name: string

  /** Terrain of attacking tile used for flank bonus */
  attacker_staging_terrain: string

  attacker_military_base: number
  defender_military_base: number
  attacker_terrain_bonus: number
  defender_terrain_bonus: number
  /** Deterministic d20 faces (1–20) for ledger + physical die ceremony */
  attacker_roll: number
  defender_roll: number
  attacker_total: number
  defender_total: number

  winner: 'attacker' | 'defender'

  attacker_population_lost: number
  defender_population_lost: number
  attacker_military_lost: number
  defender_military_lost: number

  /** Epic classroom copy */
  narrative: string
}
