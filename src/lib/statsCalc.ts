import type { HexCell } from './hexUtils'
import type { CivResources, GameSettings } from '../types/resources'
import { DEFAULT_CIV_RESOURCES } from '../types/resources'
import type { Civilization } from '../contexts/StudentContext'

// Per-tech flat bonuses to production each turn
const TECH_BONUSES: Partial<Record<string, Partial<Record<'food' | 'timber' | 'stone' | 'knowledge' | 'military', number>>>> = {
  agriculture:    { food: 3 },
  irrigation:     { food: 5 },
  crop_rotation:  { food: 7 },
  logging:        { timber: 3 },
  masonry:        { stone: 3 },
  writing:        { knowledge: 3 },
  library:        { knowledge: 5 },
  philosophy:     { knowledge: 8 },
  academy:        { knowledge: 12 },
  bronze_working: { military: 5 },
  iron_working:   { military: 10 },
  tactics:        { military: 15 },
}

// Per-policy multipliers on derived core stats
const POLICY_MULTIPLIERS: Partial<Record<string, Partial<Record<keyof CivResources, number>>>> = {
  trade:       { wealth: 1.5, gold: 1.3 },
  militarism:  { military: 1.5 },
  scholarship: { knowledge: 1.5 },
  agrarianism: { food: 1.3 },
}

// Luxury resources are claimed by owning specific hex types
function deriveLuxuries(cells: HexCell[]): Pick<CivResources, 'spices' | 'silk' | 'marble' | 'horses' | 'iron'> {
  const lux = { spices: false, silk: false, marble: false, horses: false, iron: false }
  for (const c of cells) {
    if (c.resource === 'gems') lux.spices = true
    if (c.terrain === 'jungle') lux.silk = true
    if (c.resource === 'stone' && (c.terrain === 'hills' || c.terrain === 'mountain')) lux.marble = true
    if (c.terrain === 'steppe' || c.terrain === 'plains') lux.horses = true
    if (c.resource === 'iron') lux.iron = true
  }
  return lux
}

export function parseCivResources(raw: Record<string, unknown>): CivResources {
  const d = DEFAULT_CIV_RESOURCES
  const num  = (v: unknown, fb: number)  => typeof v === 'number'  ? v : fb
  const bool = (v: unknown, fb: boolean) =>
    typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : fb

  return {
    population: num(raw.population, d.population),
    military:   num(raw.military,   d.military),
    wealth:     num(raw.wealth,     d.wealth),
    knowledge:  num(raw.knowledge,  d.knowledge),
    food:       num(raw.food,       d.food),
    timber:     num(raw.timber,     d.timber),
    gold:       num(raw.gold,       d.gold),
    stone:      num(raw.stone,      d.stone),
    spices: bool(raw.spices, d.spices),
    silk:   bool(raw.silk,   d.silk),
    marble: bool(raw.marble, d.marble),
    horses: bool(raw.horses, d.horses),
    iron:   bool(raw.iron,   d.iron),
  }
}

/**
 * Calculate one turn of resource/stat changes for a civilization.
 *
 * Pass ownedCells (hex cells where cell.owner === civ.id) to derive
 * terrain production and luxury access; omit it to use stored values only.
 */
export function calculateStatsForTurn(
  civ: Civilization,
  settings: GameSettings,
  ownedCells?: HexCell[],
  options?: { freezeMilitary?: boolean },
): CivResources {
  const res   = parseCivResources(civ.resources as Record<string, unknown>)
  const techs    = new Set(civ.techs    ?? [])
  const policies = new Set(civ.policies ?? [])
  const m = settings.resourceMultiplier

  // ── 1. Terrain-based production ─────────────────────────────────────────
  let foodProd = 0, timberProd = 0, goldProd = 0, stoneProd = 0, wealthProd = 0

  if (ownedCells?.length) {
    for (const c of ownedCells) {
      switch (c.terrain) {
        case 'plains':   foodProd   += 2; break
        case 'steppe':   foodProd   += 1; break
        case 'forest':   timberProd += 2; break
        case 'jungle':   timberProd += 1; break
        case 'hills':    stoneProd  += 2; break
        case 'mountain': stoneProd  += 1; break
        case 'coast':    wealthProd += 2; break
        case 'river':    foodProd   += 1; wealthProd += 1; break
        default: break
      }
      // Bonus from hex resource node
      if (c.resource === 'wheat') foodProd   += 1
      if (c.resource === 'wood')  timberProd += 1
      if (c.resource === 'stone') stoneProd  += 1
      if (c.resource === 'gold')  goldProd   += 2
      if (c.resource === 'fish')  foodProd   += 1
    }
    Object.assign(res, deriveLuxuries(ownedCells))
  }

  // ── 2. Tech flat bonuses ────────────────────────────────────────────────
  let techFoodBonus = 0, techTimberBonus = 0, techStoneBonus = 0
  let techKnowBonus = 0, techMilBonus = 0
  for (const tech of techs) {
    const b = TECH_BONUSES[tech]
    if (!b) continue
    techFoodBonus   += b.food     ?? 0
    techTimberBonus += b.timber   ?? 0
    techStoneBonus  += b.stone    ?? 0
    techKnowBonus   += b.knowledge ?? 0
    techMilBonus    += b.military  ?? 0
  }
  foodProd   += techFoodBonus
  timberProd += techTimberBonus
  stoneProd  += techStoneBonus

  // ── 3. Accumulate trade resources ───────────────────────────────────────
  res.food   += Math.round(foodProd   * m)
  res.timber += Math.round(timberProd * m)
  res.gold   += Math.round(goldProd   * m)
  res.stone  += Math.round(stoneProd  * m)

  // ── 4. Policy multipliers ───────────────────────────────────────────────
  let wealthMult = 1, militaryMult = 1, knowledgeMult = 1, foodMult = 1
  for (const policy of policies) {
    const pm = POLICY_MULTIPLIERS[policy]
    if (!pm) continue
    if (pm.wealth)    wealthMult    *= pm.wealth
    if (pm.military)  militaryMult  *= pm.military
    if (pm.knowledge) knowledgeMult *= pm.knowledge
    if (pm.food)      foodMult      *= pm.food
  }

  // ── 5. Derive core stats ────────────────────────────────────────────────

  // Wealth accumulates from coast/gold terrain and policy multipliers
  res.wealth = Math.round((res.wealth + (wealthProd + goldProd) * m) * wealthMult)

  // Population grows with food surplus; shrinks on severe shortage
  const foodDemand  = Math.ceil(res.population * 0.05)
  const foodSurplus = res.food - foodDemand
  res.food = Math.max(0, res.food - foodDemand)

  if (foodSurplus > 0) {
    res.population += Math.floor(foodSurplus * settings.growthRate * foodMult)
  } else if (foodSurplus < -5) {
    res.population = Math.max(10, res.population + foodSurplus)
  }

  // Military is capped by gold reserves + iron access, then tech/policy modified
  if (!options?.freezeMilitary) {
    const goldPerSoldier = Math.max(1, settings.militaryMaintenance)
    const milFromGold = Math.floor(res.gold / goldPerSoldier)
    const milCap = (res.iron ? milFromGold * 2 : milFromGold) + techMilBonus
    const targetMil = Math.round(milCap * militaryMult)
    res.military = Math.max(0, Math.min(res.military + 5, targetMil))
  }

  // Knowledge grows each turn proportional to tech count × rate
  res.knowledge = Math.round(
    res.knowledge + (techs.size * settings.knowledgeRate + techKnowBonus) * knowledgeMult
  )

  return res
}
