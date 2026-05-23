import type {
  TechDefinition,
  TechEraId,
  TechEraInfo,
  TechStatBonuses,
  TechUnlockedAction,
} from '../types/techTree'

// ─── Era bands (lesson pacing) ──────────────────────────────────────────────

export const TECH_ERA_DETAILS: TechEraInfo[] = [
  {
    id: 'bronze',
    label: 'ERA I · Bronze Age',
    turnRangeLabel: 'Turns 1–3 syllabus focus',
  },
  {
    id: 'iron',
    label: 'ERA II · Iron Age',
    turnRangeLabel: 'Turns 4–6 syllabus focus',
  },
  {
    id: 'classical',
    label: 'ERA III · Classical',
    turnRangeLabel: 'Turns 7–10 syllabus focus',
  },
]

/** First turn on which inventions of this age may legally complete in the ledger. */
export const ERA_GATE_TURN: Record<TechEraId, number> = {
  bronze: 1,
  iron: 4,
  classical: 7,
}

// ─── Master definitions ─────────────────────────────────────────────────────

export const TECH_DEFINITIONS: TechDefinition[] = [
  {
    id: 'agriculture',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Agriculture',
    prerequisites: [],
    knowledgeCost: 24,
    statBonuses: { food: 3 },
  },
  {
    id: 'bronze_weapons',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Bronze Weapons',
    prerequisites: ['agriculture'],
    knowledgeCost: 28,
    statBonuses: { military: 4 },
  },
  {
    id: 'pottery',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Pottery',
    prerequisites: ['agriculture'],
    knowledgeCost: 22,
    statBonuses: { knowledge: 2 },
  },
  {
    id: 'sailing',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Sailing',
    prerequisites: ['pottery'],
    knowledgeCost: 32,
    statBonuses: { coastalFood: 2 },
    unlockedActions: ['EXPLORE'],
  },
  {
    id: 'writing',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Writing',
    prerequisites: ['pottery'],
    knowledgeCost: 30,
    statBonuses: { knowledge: 4 },
  },
  {
    id: 'trade_routes',
    era: 'bronze',
    earliestTurn: 1,
    displayName: 'Trade Routes',
    prerequisites: ['writing', 'sailing'],
    knowledgeCost: 36,
    statBonuses: { gold: 4, wealth: 2 },
  },

  // ── Iron Age ───────────────────────────────────────────────────────────────
  {
    id: 'iron_working',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Iron Working',
    prerequisites: ['bronze_weapons'],
    knowledgeCost: 48,
    statBonuses: { military: 3, ironIndustry: true },
  },
  {
    id: 'philosophy',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Philosophy',
    prerequisites: ['writing'],
    knowledgeCost: 44,
    statBonuses: { knowledge: 6 },
  },
  {
    id: 'currency',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Currency',
    prerequisites: ['trade_routes'],
    knowledgeCost: 40,
    statBonuses: { gold: 5, wealth: 4 },
  },
  {
    id: 'engineering',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Engineering',
    prerequisites: ['bronze_weapons', 'pottery'],
    knowledgeCost: 46,
    statBonuses: { stone: 4, military: 2 },
  },
  {
    id: 'military_tactics',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Military Tactics',
    prerequisites: ['bronze_weapons'],
    knowledgeCost: 42,
    statBonuses: { military: 8 },
  },
  {
    id: 'diplomacy',
    era: 'iron',
    earliestTurn: 4,
    displayName: 'Diplomacy',
    prerequisites: ['writing', 'philosophy'],
    knowledgeCost: 38,
    statBonuses: { knowledge: 3, wealth: 3 },
  },

  // ── Classical ──────────────────────────────────────────────────────────────
  {
    id: 'mathematics',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Mathematics',
    prerequisites: ['philosophy'],
    knowledgeCost: 52,
    statBonuses: { knowledge: 8 },
  },
  {
    id: 'architecture',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Architecture',
    prerequisites: ['engineering', 'mathematics'],
    knowledgeCost: 55,
    statBonuses: { stone: 3, wealth: 5 },
    unlockedBuildings: ['great_wonder'],
  },
  {
    id: 'naval_power',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Naval Power',
    prerequisites: ['sailing', 'engineering'],
    knowledgeCost: 50,
    statBonuses: { coastalFood: 1, coastalWealth: 3, military: 3 },
  },
  {
    id: 'law',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Law',
    prerequisites: ['writing', 'diplomacy'],
    knowledgeCost: 48,
    statBonuses: { knowledge: 5, wealth: 4 },
  },
  {
    id: 'medicine',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Medicine',
    prerequisites: ['philosophy'],
    knowledgeCost: 46,
    statBonuses: { food: 2, knowledge: 3 },
  },
  {
    id: 'siege_warfare',
    era: 'classical',
    earliestTurn: 7,
    displayName: 'Siege Warfare',
    prerequisites: ['military_tactics', 'engineering'],
    knowledgeCost: 58,
    statBonuses: { military: 10 },
  },
]

export const TECH_BY_ID: Record<string, TechDefinition> = Object.fromEntries(
  TECH_DEFINITIONS.map((t) => [t.id, t]),
)

export function getTechDefinition(id: string): TechDefinition | undefined {
  return TECH_BY_ID[id]
}

/** Knowledge ledger costs — shared by client selectors + resolver. */
export const RESEARCH_KNOWLEDGE_COSTS: Record<string, number> = Object.fromEntries(
  TECH_DEFINITIONS.map((t) => [t.id, t.knowledgeCost]),
)

/** Display order inside each era panel (reading lines on the syllabus). */
const ERA_DISPLAY_ORDER_BRONZE = [
  'agriculture',
  'bronze_weapons',
  'pottery',
  'writing',
  'sailing',
  'trade_routes',
]

const ERA_DISPLAY_ORDER_IRON = [
  'iron_working',
  'philosophy',
  'currency',
  'engineering',
  'military_tactics',
  'diplomacy',
]

const ERA_DISPLAY_ORDER_CLASSICAL = [
  'mathematics',
  'architecture',
  'naval_power',
  'law',
  'medicine',
  'siege_warfare',
]

export const ALL_TECH_IDS_IN_ORDER = [
  ...ERA_DISPLAY_ORDER_BRONZE,
  ...ERA_DISPLAY_ORDER_IRON,
  ...ERA_DISPLAY_ORDER_CLASSICAL,
]

export function prerequisitesMet(subjectTechIds: Iterable<string>, def: TechDefinition): boolean {
  const have = subjectTechIds instanceof Set ? subjectTechIds : new Set(subjectTechIds)
  return def.prerequisites.every((pre) => have.has(pre))
}

/** Resolver + UI: inventions available once the calendar catches the era syllabus. */
export function eraOpensOnTurn(def: TechDefinition): number {
  return Math.max(def.earliestTurn, ERA_GATE_TURN[def.era])
}

export type TechTreeNodeStatus =
  | 'researched'
  | 'available'
  | 'locked_turn'
  | 'locked_missing_prereqs'
  | 'unknown'

/** Visual + UX state for one node (solver uses stricter resolver messages separately). */
export function computeTechNodeStatus(
  def: TechDefinition,
  researched: ReadonlySet<string>,
  calendarTurn: number,
): TechTreeNodeStatus {
  if (researched.has(def.id)) return 'researched'
  const gate = eraOpensOnTurn(def)
  if (calendarTurn < gate) return 'locked_turn'
  if (!prerequisitesMet(researched, def)) return 'locked_missing_prereqs'
  return 'available'
}

export function civilizationHasTechAction(
  researched: Iterable<string>,
  token: TechUnlockedAction | string | undefined,
): boolean {
  if (!token) return false
  for (const tid of researched) {
    const d = TECH_BY_ID[tid]
    if (!d?.unlockedActions?.includes(token as TechUnlockedAction)) continue
    return true
  }
  return false
}

export function civilizationMayBuild(
  researched: Iterable<string>,
  buildingId: string,
): boolean {
  if (buildingId !== 'great_wonder') return true
  const want = researched instanceof Set ? researched : new Set(researched)
  for (const id of want) {
    const d = TECH_BY_ID[id]
    if (!d?.unlockedBuildings?.includes(buildingId)) continue
    return true
  }
  return false
}

/**
 * Cartesian coordinates inside the SVG viewBox — chosen for prerequisite edges.
 * Three vertical columns aligned with eras.
 */
export function techLayoutCoordinates(id: string): { x: number; y: number } {
  const table: Partial<Record<string, { x: number; y: number }>> = {
    // Bronze column
    agriculture: { x: 72, y: 88 },
    pottery: { x: 226, y: 88 },
    bronze_weapons: { x: 72, y: 214 },
    writing: { x: 226, y: 214 },
    sailing: { x: 72, y: 340 },
    trade_routes: { x: 226, y: 340 },
    // Iron column
    iron_working: { x: 388, y: 88 },
    philosophy: { x: 542, y: 88 },
    currency: { x: 388, y: 214 },
    diplomacy: { x: 542, y: 214 },
    engineering: { x: 388, y: 340 },
    military_tactics: { x: 542, y: 340 },
    // Classical column
    mathematics: { x: 704, y: 88 },
    law: { x: 858, y: 88 },
    architecture: { x: 704, y: 214 },
    medicine: { x: 858, y: 214 },
    naval_power: { x: 704, y: 340 },
    siege_warfare: { x: 858, y: 340 },
  }

  const p = table[id] ?? { x: 460, y: 220 }
  return { x: p.x, y: p.y }
}

export function summarizeBonusLine(b: TechStatBonuses): string {
  const parts: string[] = []
  if (b.food) parts.push(`+${b.food} food`)
  if (b.timber) parts.push(`+${b.timber} timber`)
  if (b.stone) parts.push(`+${b.stone} stone`)
  if (b.gold) parts.push(`+${b.gold} gold`)
  if (b.wealth) parts.push(`+${b.wealth} wealth`)
  if (b.knowledge) parts.push(`+${b.knowledge} knowledge`)
  if (b.military) parts.push(`+${b.military} military`)
  if (b.coastalFood) parts.push(`coasts +${b.coastalFood} food`)
  if (b.coastalWealth) parts.push(`coasts +${b.coastalWealth} wealth`)
  if (b.ironIndustry) parts.push('iron industry')
  return parts.length ? parts.join(' · ') : '—'
}
