import type { HexMapData, TerrainType } from './hexUtils'
import type { CombatLogEntry } from '../types/combat'
import { getCellAt, oddRNeighbors, TERRAIN_LABELS } from './hexUtils'

// ─── Defender bonuses (battlefield hex) ───────────────────────────────────────

export function defenderTerrainDefenseBonus(t: TerrainType): number {
  switch (t) {
    case 'hills':
      return 3
    case 'forest':
    case 'jungle':
      return 2
    case 'coast':
      return 1
    case 'plains':
    case 'steppe':
      return 0
    case 'desert':
      return -1
    case 'mountain':
      return 5
    case 'river':
      return 2
    case 'lake':
      return 1
    case 'tundra':
      return 0
    default:
      return 0
  }
}

// ─── Attacker bonuses (owned staging hex touching defender tile) ───────────

export function attackerStagingTerrainBonus(t: TerrainType): number {
  switch (t) {
    case 'hills':
      return 2
    case 'forest':
    case 'jungle':
      return 2
    case 'mountain':
      return 2
    case 'river':
      return 1
    case 'coast':
      return 1
    case 'plains':
      return 0
    case 'steppe':
      return 1
    case 'desert':
      return -1
    case 'lake':
      return 0
    case 'tundra':
      return 0
    default:
      return 0
  }
}

/** Deterministic 1–20 roll (classroom d20); same seed → same face for replay / ledger. */
function fnv1d20(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 20) + 1
}

function stagingPick(map: HexMapData, tq: number, tr: number, attackerId: string): {
  terrain: TerrainType
  bonus: number
} {
  let bestBonus = Number.NEGATIVE_INFINITY
  let bestQ = Number.POSITIVE_INFINITY
  let bestR = Number.POSITIVE_INFINITY
  let terrain: TerrainType = 'plains'

  for (const { q, r } of oddRNeighbors(tq, tr, map.cols, map.rows)) {
    const c = getCellAt(map, q, r)
    if (!c || c.owner !== attackerId) continue
    const b = attackerStagingTerrainBonus(c.terrain)
    const better = b > bestBonus || (b === bestBonus && (q < bestQ || (q === bestQ && r < bestR)))
    if (better) {
      bestBonus = b
      bestQ = q
      bestR = r
      terrain = c.terrain
    }
  }

  return {
    terrain,
    bonus: bestBonus === Number.NEGATIVE_INFINITY ? 0 : bestBonus,
  }
}

export function resolveCombatDiceBattle(args: {
  gameId: string
  turnNumber: number
  slotRowId: string

  attackerCivId: string
  defenderCivId: string
  attackerName: string
  defenderName: string

  q: number
  r: number
  defenderTerrain: TerrainType

  attackerMilitaryBase: number
  defenderMilitaryBase: number

  map: HexMapData

  attackerSnapPop: number
  defenderSnapPop: number
}): {
  attackerWinsHex: boolean
  entry: CombatLogEntry
  attackerMilAfterLoss: number
  defenderMilAfterLoss: number
  attackerPopAfterLoss: number
  defenderPopAfterLoss: number
} {
  const staging = stagingPick(args.map, args.q, args.r, args.attackerCivId)
  const defBonus = defenderTerrainDefenseBonus(args.defenderTerrain)

  const seedBase = `${args.gameId}|t${args.turnNumber}|${args.slotRowId}`
  const atkRoll = fnv1d20(`${seedBase}|atk-roll`)
  const defRoll = fnv1d20(`${seedBase}|def-roll`)

  const atkTotal = Math.floor(args.attackerMilitaryBase) + staging.bonus + atkRoll
  const defTotal = Math.floor(args.defenderMilitaryBase) + defBonus + defRoll

  const attackerWins = atkTotal > defTotal

  const intensity = atkTotal + defTotal

  let atkPop = Math.max(1, Math.floor((intensity * 14) / 100))
  let defPop = Math.max(1, Math.floor((intensity * 12) / 100))

  if (attackerWins) defPop += Math.floor(defPop / 2)
  else atkPop += Math.floor(atkPop / 2)

  atkPop = Math.min(atkPop, Math.max(1, Math.floor(args.attackerSnapPop * 0.25)))
  defPop = Math.min(defPop, Math.max(1, Math.floor(args.defenderSnapPop * 0.25)))

  const atkMilBase = Math.floor(args.attackerMilitaryBase)
  const defMilBase = Math.floor(args.defenderMilitaryBase)

  let atkMilLost: number
  let defMilLost: number

  if (attackerWins) {
    atkMilLost = Math.max(3, Math.floor(atkMilBase * 0.12 + intensity / 50))
    defMilLost = Math.max(10, Math.floor(defMilBase * 0.28 + intensity / 35))
  } else {
    atkMilLost = Math.max(10, Math.floor(atkMilBase * 0.22 + intensity / 30))
    defMilLost = Math.max(3, Math.floor(defMilBase * 0.13 + intensity / 55))
  }

  atkMilLost = Math.min(atkMilLost, atkMilBase)
  defMilLost = Math.min(defMilLost, defMilBase)

  const battlefieldLabel = TERRAIN_LABELS[args.defenderTerrain] ?? String(args.defenderTerrain)
  const stagingLabel = TERRAIN_LABELS[staging.terrain] ?? String(staging.terrain)

  const narrative = narratorLine({
    atk: args.attackerName,
    def: args.defenderName,
    terrain: battlefieldLabel,
    staging: stagingLabel,
    q: args.q,
    r: args.r,
    winner: attackerWins ? ('attacker' as const) : ('defender' as const),
    atkTot: atkTotal,
    defTot: defTotal,
    atkRoll,
    defRoll,
  })

  const entry: CombatLogEntry = {
    slot_id: args.slotRowId,
    resolved_turn: args.turnNumber,
    q: args.q,
    r: args.r,
    defender_hex_terrain: battlefieldLabel,

    attacker_civ_id: args.attackerCivId,
    defender_civ_id: args.defenderCivId,
    attacker_name: args.attackerName,
    defender_name: args.defenderName,

    attacker_staging_terrain: stagingLabel,

    attacker_military_base: atkMilBase,
    defender_military_base: defMilBase,
    attacker_terrain_bonus: staging.bonus,
    defender_terrain_bonus: defBonus,
    attacker_roll: atkRoll,
    defender_roll: defRoll,
    attacker_total: atkTotal,
    defender_total: defTotal,

    winner: attackerWins ? 'attacker' : 'defender',

    attacker_population_lost: atkPop,
    defender_population_lost: defPop,
    attacker_military_lost: atkMilLost,
    defender_military_lost: defMilLost,

    narrative,
  }

  return {
    attackerWinsHex: attackerWins,
    entry,
    attackerMilAfterLoss: Math.max(0, atkMilBase - atkMilLost),
    defenderMilAfterLoss: Math.max(0, defMilBase - defMilLost),
    attackerPopAfterLoss: Math.max(10, args.attackerSnapPop - atkPop),
    defenderPopAfterLoss: Math.max(10, args.defenderSnapPop - defPop),
  }
}

function narratorLine(p: {
  atk: string
  def: string
  terrain: string
  staging: string
  q: number
  r: number
  winner: 'attacker' | 'defender'
  atkTot: number
  defTot: number
  atkRoll: number
  defRoll: number
}): string {
  const crest = `[${p.q}, ${p.r}]`
  const rollBit =
    `${p.atk}'s host cast the classroom d20 and read ${p.atkRoll}; ${p.def}'s shield-wall answered ${p.defRoll}. ` +
    `The reckoners shouted ${p.atkTot} against ${p.defTot}.`

  if (p.winner === 'attacker') {
    return (
      `${p.atk} rose from ${p.staging.toLowerCase()} earth and swallowed ${crest}, ` +
      `where ancient ${p.terrain.toLowerCase()} turf once favoured ${p.def}. ` +
      `${rollBit} War-banners tumble—${p.def} flees shattered cordons.`
    )
  }

  return (
    `${p.def}'s hearth-guard rallied through ${crest}'s grim ${p.terrain.toLowerCase()} ` +
    `even as ${p.atk}'s zeal poured out of neighbouring ${p.staging.toLowerCase()}. ` +
    `${rollBit} The siege breaks; crows wheel above ${p.atk}'s retreat.`
  )
}

/** Extract `combat_log` array from `turns.events` (JSONB ledger blob). */
export function combatLogEntriesFromTurnEvents(eventsUnknown: unknown): CombatLogEntry[] {
  if (!eventsUnknown || typeof eventsUnknown !== 'object') return []
  const o = eventsUnknown as Record<string, unknown>
  const raw = o.combat_log
  if (!Array.isArray(raw)) return []
  const out: CombatLogEntry[] = []
  for (const item of raw) {
    if (item && typeof item === 'object') out.push(item as CombatLogEntry)
  }
  return out
}
