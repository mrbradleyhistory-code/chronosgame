// ─── Tech tree (bronze · iron · classical) — costs + AP bonuses ───────────────

import { ALL_TECH_IDS_IN_ORDER, RESEARCH_KNOWLEDGE_COSTS } from './techTree'

/** Knowledge cost keyed by canonical tech ids (persisted on civilizations.techs). */
export const RESEARCH_COSTS: Record<string, number> = { ...RESEARCH_KNOWLEDGE_COSTS }

export const RESEARCH_TECH_ORDER = [...ALL_TECH_IDS_IN_ORDER]

// ─── BUILD actions ─────────────────────────────────────────────────────────────

export interface BuildingDef {
  id: string
  displayName: string
  /** Action point cost to queue */
  apCost: 1 | 2
  /** Gold + stone price at resolution (soft requirements) */
  goldCost?: number
  stoneCost?: number
}

export const BUILDING_DEFS: Record<string, BuildingDef> = {
  granary: { id: 'granary', displayName: 'Granary', apCost: 1, goldCost: 5 },
  barracks: { id: 'barracks', displayName: 'Barracks', apCost: 1, goldCost: 10 },
  monument: { id: 'monument', displayName: 'Monument', apCost: 2, stoneCost: 8, goldCost: 15 },
  great_wonder: {
    id: 'great_wonder',
    displayName: 'Grand Wonder',
    apCost: 2,
    goldCost: 50,
    stoneCost: 30,
  },
}

// ─── Adoptable policies (subset; must match POLICY_MULTIPLIERS keys in statsCalc) ───

export const ADOPTABLE_POLICY_IDS = ['trade', 'militarism', 'scholarship', 'agrarianism'] as const

// ─── AP modifiers from tech / policy (client + resolver share numbers) ─────

const AP_BONUS_TECH_IDS = new Set(['trade_routes', 'diplomacy'])

export function bonusActionPointsFromCiv(techs: string[], policies: string[]): number {
  let n = 0
  for (const t of techs ?? []) if (AP_BONUS_TECH_IDS.has(t)) n++
  if (policies.includes('trade')) n += 1
  return Math.min(n, 2)
}
