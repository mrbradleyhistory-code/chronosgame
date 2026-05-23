// ─── Unlockable techs (RESEARCH actions) ────────────────────────────────────

/** Knowledge cost to permanently unlock */
export const RESEARCH_COSTS: Record<string, number> = {
  organization: 30,
  guilds: 40,
  agriculture: 25,
  irrigation: 40,
  crop_rotation: 55,
  logging: 22,
  masonry: 22,
  writing: 30,
  library: 50,
  philosophy: 70,
  academy: 100,
  bronze_working: 35,
  iron_working: 60,
  tactics: 80,
}

export const RESEARCH_TECH_ORDER = Object.keys(RESEARCH_COSTS)

// ─── BUILD actions ───────────────────────────────────────────────────────────

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
}

// ─── Adoptable policies (subset; must match POLICY_MULTIPLIERS keys in statsCalc) ───

export const ADOPTABLE_POLICY_IDS = ['trade', 'militarism', 'scholarship', 'agrarianism'] as const

// ─── AP modifiers from tech / policy (client + server RPC validation share numbers) ───

const AP_BONUS_TECHS = new Set<string>(['organization', 'guilds'])

export function bonusActionPointsFromCiv(techs: string[], policies: string[]): number {
  let n = 0
  for (const t of techs ?? []) if (AP_BONUS_TECHS.has(t)) n++
  if (policies.includes('trade')) n += 1
  return Math.min(n, 2)
}
