export interface CivResources {
  // Core stats — derived each turn from owned terrain, techs, and policies
  population: number
  military:   number
  wealth:     number
  knowledge:  number
  // Trade resources — accumulated from terrain production
  food:   number
  timber: number
  gold:   number
  stone:  number
  // Luxury resources — boolean, granted by owning the right hex type
  spices: boolean
  silk:   boolean
  marble: boolean
  horses: boolean
  iron:   boolean
}

export interface GameSettings {
  /** Scales all terrain resource production (default 1.0) */
  resourceMultiplier: number
  /** Population added per food-surplus point per turn (default 0.1) */
  growthRate: number
  /** Gold consumed per military point per turn (default 1) */
  militaryMaintenance: number
  /** Knowledge gained per tech entry per turn (default 5) */
  knowledgeRate: number
  /** Maximum action-point budget each planning phase (default 3) */
  baseActionPoints: number
  /** Minimum population required to queue EXPAND (default 40) */
  expandPopulationThreshold: number
}

export const DEFAULT_CIV_RESOURCES: CivResources = {
  population: 100,
  military:   0,
  wealth:     0,
  knowledge:  0,
  food:       10,
  timber:     5,
  gold:       0,
  stone:      0,
  spices: false,
  silk:   false,
  marble: false,
  horses: false,
  iron:   false,
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  resourceMultiplier:  1.0,
  growthRate:          0.1,
  militaryMaintenance: 1,
  knowledgeRate:       5,
  baseActionPoints:    3,
  expandPopulationThreshold: 40,
}

/** Merge partial JSON `games.settings` with defaults */
export function parseGameSettings(raw: unknown): GameSettings {
  const d = DEFAULT_GAME_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  return {
    resourceMultiplier:  num(o.resourceMultiplier, d.resourceMultiplier),
    growthRate:          num(o.growthRate, d.growthRate),
    militaryMaintenance: num(o.militaryMaintenance, d.militaryMaintenance),
    knowledgeRate:       num(o.knowledgeRate, d.knowledgeRate),
    baseActionPoints:    num(o.baseActionPoints, d.baseActionPoints),
    expandPopulationThreshold: num(o.expandPopulationThreshold, d.expandPopulationThreshold),
  }
}

export function serializeCivResources(cr: CivResources): Record<string, number | boolean> {
  return {
    population: cr.population,
    military: cr.military,
    wealth: cr.wealth,
    knowledge: cr.knowledge,
    food: cr.food,
    timber: cr.timber,
    gold: cr.gold,
    stone: cr.stone,
    spices: cr.spices,
    silk: cr.silk,
    marble: cr.marble,
    horses: cr.horses,
    iron: cr.iron,
  }
}
