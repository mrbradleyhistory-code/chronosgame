/** Three-age ancient tech progression (thematic grouping + earliest turn gate). */

export type TechEraId = 'bronze' | 'iron' | 'classical'

/** Mirrors JSONB-ish stat bonuses persisted in defs (readable in-game). */
export interface TechStatBonuses {
  food?: number
  timber?: number
  stone?: number
  gold?: number
  wealth?: number
  knowledge?: number
  military?: number
  /** Extra food from each coastal hex you own */
  coastalFood?: number
  /** Extra wealth from each coastal hex you own */
  coastalWealth?: number
  /**
   * When true (Iron Working): military cap treats iron forging as mastered even
   * before holding an iron tile (production lux still needs terrain).
   */
  ironIndustry?: boolean
}

/** Player-facing decree types a tech formally unlocks. */
export type TechUnlockedAction = 'EXPLORE'

export interface TechDefinition {
  id: string
  era: TechEraId
  /** First calendar century when this lineage may enter the lab */
  earliestTurn: number
  displayName: string
  prerequisites: string[]
  knowledgeCost: number
  statBonuses: TechStatBonuses
  unlockedActions?: TechUnlockedAction[]
  /** BUILD blueprint ids gated by this science */
  unlockedBuildings?: string[]
}

export interface TechEraInfo {
  id: TechEraId
  label: string
  /** Inclusive pedagogical span on the syllabus */
  turnRangeLabel: string
}
