import type { HexMapData, HexCell, TerrainType } from './hexUtils'
import { getCellAt, hexKey, oddRNeighbors, countExploredForCiv } from './hexUtils'

/** Land tiles suitable for a founding settlement. */
const SPAWN_TERRAINS = new Set<TerrainType>([
  'plains',
  'forest',
  'hills',
  'desert',
  'jungle',
  'steppe',
  'tundra',
  'coast',
])

export interface CivPlacementOptions {
  /** Hex distance revealed around the capital (1 = adjacent ring, 2 = two rings). */
  visionRadius?: number
  /** Minimum hex distance between civilization capitals. */
  minStartDistance?: number
}

export interface CivPlacementResult {
  map: HexMapData
  changed: boolean
  placements: Array<{ civId: string; q: number; r: number }>
}

function strToSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function cloneMap(map: HexMapData): HexMapData {
  return {
    cols: map.cols,
    rows: map.rows,
    cells: map.cells.map((c) => ({
      ...c,
      owner: c.owner ?? null,
      explored_by: Array.isArray(c.explored_by) ? [...c.explored_by] : [],
    })),
  }
}

function oddRToCube(q: number, r: number) {
  const x = q - (r - (r & 1)) / 2
  const z = r
  const y = -x - z
  return { x, y, z }
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const a = oddRToCube(q1, r1)
  const b = oddRToCube(q2, r2)
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

/** First owned hex for a civ, if any. */
export function findCivCapital(map: HexMapData, civId: string): { q: number; r: number } | null {
  for (const cell of map.cells) {
    if (cell.owner === civId) return { q: cell.q, r: cell.r }
  }
  return null
}

export function civHasCapital(map: HexMapData, civId: string): boolean {
  return findCivCapital(map, civId) != null
}

function cellsWithinRadius(
  map: HexMapData,
  q: number,
  r: number,
  radius: number,
): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = []
  const seen = new Set<string>()
  const queue: Array<{ q: number; r: number; d: number }> = [{ q, r, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const k = hexKey(cur.q, cur.r)
    if (seen.has(k)) continue
    seen.add(k)
    if (!getCellAt(map, cur.q, cur.r)) continue
    out.push({ q: cur.q, r: cur.r })
    if (cur.d >= radius) continue
    for (const nb of oddRNeighbors(cur.q, cur.r, map.cols, map.rows)) {
      queue.push({ q: nb.q, r: nb.r, d: cur.d + 1 })
    }
  }
  return out
}

function revealForCiv(map: HexMapData, civId: string, q: number, r: number, radius: number) {
  for (const coord of cellsWithinRadius(map, q, r, radius)) {
    const cell = getCellAt(map, coord.q, coord.r)
    if (!cell || cell.explored_by.includes(civId)) continue
    cell.explored_by = [...cell.explored_by, civId]
  }
}

/** If a civ owns tiles but fog was never set, reveal around their capital. */
export function repairCivFog(mapIn: HexMapData, civId: string, visionRadius = 2): HexMapData {
  const map = cloneMap(mapIn)
  let cap = findCivCapital(map, civId)
  if (!cap) return map

  const before = map.cells.filter((c) => c.explored_by.includes(civId)).length
  revealForCiv(map, civId, cap.q, cap.r, visionRadius)
  const after = map.cells.filter((c) => c.explored_by.includes(civId)).length
  return after > before ? map : mapIn
}

/** Guarantee one civ can see their start — place if missing, then repair fog. */
export function ensureStudentCanSeeMap(
  mapIn: HexMapData,
  civId: string,
  allCivIds: string[],
  worldSeed: string,
): CivPlacementResult {
  const ids = allCivIds.length > 0 ? allCivIds : [civId]
  let result = ensureCivilizationsPlaced(mapIn, ids, worldSeed)

  if (!findCivCapital(result.map, civId)) {
    result = ensureCivilizationsPlaced(result.map, [civId], `${worldSeed}:solo:${civId}`, {
      minStartDistance: 0,
    })
  }

  const repaired = repairCivFog(result.map, civId, 2)
  const changed =
    result.changed ||
    countExploredForCiv(repaired, civId) > countExploredForCiv(mapIn, civId)

  return { map: repaired, changed, placements: result.placements }
}

const BLOCKED_EXPAND_TERRAINS = new Set<TerrainType>(['mountain', 'lake'])

/** Hexes a civ may claim with EXPAND — unowned, passable, adjacent to owned land. */
export function listValidExpandTargets(map: HexMapData, civId: string): HexCell[] {
  const out: HexCell[] = []
  const seen = new Set<string>()
  for (const cell of map.cells) {
    if (cell.owner !== civId) continue
    for (const nb of oddRNeighbors(cell.q, cell.r, map.cols, map.rows)) {
      const n = getCellAt(map, nb.q, nb.r)
      if (!n || n.owner) continue
      if (BLOCKED_EXPAND_TERRAINS.has(n.terrain)) continue
      const k = hexKey(n.q, n.r)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
  }
  return out
}

function isSpawnCandidate(cell: HexCell, requireResource: boolean): boolean {
  if (!SPAWN_TERRAINS.has(cell.terrain) || cell.owner != null) return false
  return requireResource ? cell.resource != null : true
}

function assignCivStart(
  map: HexMapData,
  civId: string,
  q: number,
  r: number,
  visionRadius: number,
): boolean {
  const cell = getCellAt(map, q, r)
  if (!cell || !isSpawnCandidate(cell, true)) return false
  cell.owner = civId
  revealForCiv(map, civId, q, r, visionRadius)
  return true
}

function existingCapitals(map: HexMapData, civIds: string[]): Array<{ civId: string; q: number; r: number }> {
  return civIds
    .map((civId) => {
      const cap = findCivCapital(map, civId)
      return cap ? { civId, ...cap } : null
    })
    .filter((x): x is { civId: string; q: number; r: number } => x != null)
}

function shuffleInPlace<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

/**
 * Place any civilization without a capital at random valid land hexes,
 * then reveal fog-of-war within `visionRadius` of each new capital.
 */
export function ensureCivilizationsPlaced(
  mapIn: HexMapData,
  civIds: string[],
  worldSeed: string,
  options: CivPlacementOptions = {},
): CivPlacementResult {
  const visionRadius = options.visionRadius ?? 2
  const minStartDistance = options.minStartDistance ?? 5

  if (civIds.length === 0) {
    return { map: mapIn, changed: false, placements: [] }
  }

  const map = cloneMap(mapIn)
  const placements: Array<{ civId: string; q: number; r: number }> = []
  const capitals = existingCapitals(map, civIds)

  const needsPlacement = civIds.filter((id) => !capitals.some((c) => c.civId === id))
  if (needsPlacement.length === 0) {
    return { map, changed: false, placements: [] }
  }

  const resourceCandidates = map.cells.filter((c) => isSpawnCandidate(c, true))
  const landCandidates = map.cells.filter((c) => isSpawnCandidate(c, false))
  shuffleInPlace(resourceCandidates, mulberry32(strToSeed(`${worldSeed}:civ-spawn`)))
  shuffleInPlace(landCandidates, mulberry32(strToSeed(`${worldSeed}:civ-spawn-land`)))

  function tryPlaceFromPool(
    civId: string,
    pool: HexCell[],
    rand: () => number,
    requireResource: boolean,
  ): boolean {
    const ordered = [...pool]
    shuffleInPlace(ordered, rand)
    for (const cell of ordered) {
      const farEnough = capitals.every(
        (cap) => hexDistance(cell.q, cell.r, cap.q, cap.r) >= minStartDistance,
      )
      if (!farEnough) continue
      const target = getCellAt(map, cell.q, cell.r)
      if (!target || !isSpawnCandidate(target, requireResource)) continue
      if (!assignCivStart(map, civId, cell.q, cell.r, visionRadius)) continue
      capitals.push({ civId, q: cell.q, r: cell.r })
      placements.push({ civId, q: cell.q, r: cell.r })
      return true
    }
    return false
  }

  for (const civId of needsPlacement) {
    const rand = mulberry32(strToSeed(`${worldSeed}:civ:${civId}`))
    const placed =
      tryPlaceFromPool(civId, resourceCandidates, rand, true) ||
      tryPlaceFromPool(civId, landCandidates, rand, false)
    void placed
  }

  return { map, changed: placements.length > 0, placements }
}
