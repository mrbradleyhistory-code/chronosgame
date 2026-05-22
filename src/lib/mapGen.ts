import type { HexCell, HexMapData, TerrainType, ResourceType } from './hexUtils'

// ─── seeded random ────────────────────────────────────────────────────────────

function strToSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ (x * 1000003) ^ (y * 1000033)
  h = Math.imul(h ^ (h >>> 16), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return (h ^ (h >>> 16)) >>> 0
}

function rand01(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296
}

// ─── noise ────────────────────────────────────────────────────────────────────

function smoothstep(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function valueNoise(x: number, y: number, seed: number, freq: number): number {
  const fx = x / freq, fy = y / freq
  const ix = Math.floor(fx), iy = Math.floor(fy)
  const sx = smoothstep(fx - ix), sy = smoothstep(fy - iy)
  const n00 = rand01(ix,     iy,     seed)
  const n10 = rand01(ix + 1, iy,     seed)
  const n01 = rand01(ix,     iy + 1, seed)
  const n11 = rand01(ix + 1, iy + 1, seed)
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy
}

function fbm(x: number, y: number, seed: number): number {
  return (
    valueNoise(x, y, seed,        8) +
    0.5  * valueNoise(x, y, seed + 1000, 4) +
    0.25 * valueNoise(x, y, seed + 2000, 2)
  ) / 1.75
}

// ─── hex neighbors (odd-r offset) ─────────────────────────────────────────────

function neighbors(q: number, r: number, cols: number, rows: number): [number, number][] {
  const parity = r & 1
  const dirs = parity === 0
    ? [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]]
    : [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]]
  return (dirs as [number,number][])
    .map(([dq, dr]) => [q + dq, r + dr] as [number,number])
    .filter(([nq, nr]) => nq >= 0 && nq < cols && nr >= 0 && nr < rows)
}

// ─── elevation ───────────────────────────────────────────────────────────────

function buildElevation(cols: number, rows: number, seed: number): number[] {
  const grid = new Array<number>(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const raw = fbm(q, r, seed)
      // Coast bias: push edges below water threshold
      const edgeDist = Math.min(q, r, cols - 1 - q, rows - 1 - r)
      const bias = Math.max(0, 1 - edgeDist / 3) * 0.48
      grid[r * cols + q] = Math.max(0, raw - bias)
    }
  }
  return grid
}

// ─── temperature (latitude-driven) ───────────────────────────────────────────

function buildTemperature(cols: number, rows: number, seed: number, elev: number[]): number[] {
  const grid = new Array<number>(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      const lat = r / Math.max(rows - 1, 1)            // 0=north, 1=south
      const distFromEquator = Math.abs(lat - 0.5) * 2  // 0 at equator, 1 at poles
      const base = Math.pow(1 - distFromEquator, 1.3)
      const noise = valueNoise(q, r, seed + 400, 12) * 0.18
      // High elevation is colder
      const elevCool = elev[i] * 0.28
      grid[i] = Math.max(0, Math.min(1, base + noise - 0.04 - elevCool))
    }
  }
  return grid
}

// ─── moisture ────────────────────────────────────────────────────────────────

function buildMoisture(cols: number, rows: number, seed: number, elev: number[]): number[] {
  const grid = new Array<number>(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      const base = valueNoise(q, r, seed + 600, 8) * 0.65
             + valueNoise(q, r, seed + 601, 3) * 0.35
      // Rain shadow effect on windward side of high terrain
      const shadow = elev[i] > 0.60 ? (elev[i] - 0.60) * 0.6 : 0
      grid[i] = Math.max(0, Math.min(1, base - shadow))
    }
  }
  return grid
}

// ─── water classification via flood fill ─────────────────────────────────────

const WATER_THRESH = 0.30

function classifyWater(
  elev: number[],
  cols: number,
  rows: number,
): { coast: Set<number>; lake: Set<number> } {
  const isWater = (q: number, r: number) => elev[r * cols + q] < WATER_THRESH

  // BFS from all edge-water hexes to find coast (ocean-connected water)
  const coast = new Set<number>()
  const queue: [number, number][] = []

  for (let q = 0; q < cols; q++) {
    if (isWater(q, 0))        queue.push([q, 0])
    if (isWater(q, rows - 1)) queue.push([q, rows - 1])
  }
  for (let r = 1; r < rows - 1; r++) {
    if (isWater(0, r))        queue.push([0, r])
    if (isWater(cols - 1, r)) queue.push([cols - 1, r])
  }

  for (const [q, r] of queue) {
    const i = r * cols + q
    if (coast.has(i) || !isWater(q, r)) continue
    coast.add(i)
    for (const [nq, nr] of neighbors(q, r, cols, rows)) {
      if (!coast.has(nr * cols + nq)) queue.push([nq, nr])
    }
  }

  // Remaining water hexes are inland lakes
  const lake = new Set<number>()
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      if (isWater(q, r) && !coast.has(i)) lake.add(i)
    }
  }

  return { coast, lake }
}

// ─── river tracing via flow field ────────────────────────────────────────────

function traceRivers(
  elev: number[],
  water: Set<number>,
  cols: number,
  rows: number,
  seed: number,
): Set<number> {
  const rivers = new Set<number>()
  const MIN_LEN = 3
  const MAX_STEPS = cols + rows

  // Build flow-to map: each hex points toward its lowest neighbor
  // (perturb slightly with noise to break symmetry and diverge paths)
  const flowTo = new Array<number>(cols * rows).fill(-1)
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      const myE = elev[i] + rand01(q, r, seed + 900) * 0.04
      let lowestE = myE
      let lowestI = -1
      for (const [nq, nr] of neighbors(q, r, cols, rows)) {
        const ni = nr * cols + nq
        const nE = elev[ni] + rand01(nq, nr, seed + 900) * 0.04
        if (nE < lowestE) { lowestE = nE; lowestI = ni }
      }
      flowTo[i] = lowestI
    }
  }

  // Identify river sources: high-elevation land hexes with sparse seeding
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      if (water.has(i)) continue
      if (elev[i] < 0.62) continue          // must be highland
      if (rand01(q, r, seed + 310) < 0.88) continue  // ~12% of highlands become sources

      // Trace flow downhill until water or dead end
      const path: number[] = []
      let cur = i
      const visited = new Set<number>()

      for (let step = 0; step < MAX_STEPS; step++) {
        if (visited.has(cur)) break
        visited.add(cur)

        if (water.has(cur)) break  // reached coast or lake — success

        if (!rivers.has(cur)) path.push(cur)  // don't double-mark existing rivers
        const next = flowTo[cur]
        if (next < 0 || next === cur) break
        cur = next
      }

      // Commit path only if it reached water and is long enough
      if (water.has(cur) && path.length >= MIN_LEN) {
        for (const idx of path) rivers.add(idx)
      }
    }
  }

  return rivers
}

// ─── biome assignment ─────────────────────────────────────────────────────────

function getBiome(temp: number, moist: number, elev: number): TerrainType {
  if (elev >= 0.80) return 'mountain'
  if (elev >= 0.68) return temp < 0.22 ? 'tundra' : 'hills'

  if (temp < 0.18) return 'tundra'

  if (temp < 0.36) {
    if (moist < 0.36) return 'steppe'
    if (moist < 0.66) return 'plains'
    return 'forest'
  }

  if (temp < 0.65) {
    if (moist < 0.26) return 'steppe'
    if (moist < 0.60) return 'plains'
    return 'forest'
  }

  // Hot zone
  if (moist < 0.34) return 'desert'
  if (moist < 0.58) return 'plains'
  return 'jungle'
}

// ─── resource placement ───────────────────────────────────────────────────────

const RESOURCES_BY_TERRAIN: Record<TerrainType, ResourceType[]> = {
  plains:   ['wheat', 'wheat', 'wheat', 'iron'],
  forest:   ['wood',  'wood',  'wood',  'gems'],
  hills:    ['stone', 'stone', 'iron',  'gold', 'gems'],
  desert:   ['gold',  'stone', 'gems'],
  coast:    ['fish',  'fish',  'gold'],
  river:    ['fish',  'fish',  'wheat'],
  mountain: ['stone', 'iron',  'gold',  'gems'],
  lake:     ['fish',  'fish',  'fish'],
  jungle:   ['wood',  'wood',  'gems'],
  steppe:   ['wheat', 'iron'],
  tundra:   ['stone', 'gems'],
}

const RESOURCE_CHANCE: Record<TerrainType, number> = {
  plains:   0.25,
  forest:   0.35,
  hills:    0.40,
  desert:   0.15,
  coast:    0.35,
  river:    0.30,
  mountain: 0.35,
  lake:     0.50,
  jungle:   0.30,
  steppe:   0.20,
  tundra:   0.12,
}

function getResource(terrain: TerrainType, q: number, r: number, seed: number): ResourceType {
  if (rand01(q, r, seed + 700) > RESOURCE_CHANCE[terrain]) return null
  const opts = RESOURCES_BY_TERRAIN[terrain]
  return opts[Math.floor(rand01(q, r, seed + 800) * opts.length)]
}

// ─── public API ──────────────────────────────────────────────────────────────

export function generateMap(worldSeed: string, cols = 30, rows = 20): HexMapData {
  const seed = strToSeed(worldSeed)

  const elev  = buildElevation(cols, rows, seed)
  const temp  = buildTemperature(cols, rows, seed, elev)
  const moist = buildMoisture(cols, rows, seed, elev)

  const { coast, lake } = classifyWater(elev, cols, rows)
  const water = new Set([...coast, ...lake])
  const rivers = traceRivers(elev, water, cols, rows, seed)

  const cells: HexCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q
      let terrain: TerrainType
      if (coast.has(i))       terrain = 'coast'
      else if (lake.has(i))   terrain = 'lake'
      else if (rivers.has(i)) terrain = 'river'
      else terrain = getBiome(temp[i], moist[i], elev[i])

      cells.push({
        q, r,
        terrain,
        resource: getResource(terrain, q, r, seed),
        owner: null,
        explored_by: [],
      })
    }
  }

  return { cols, rows, cells }
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
