import type { HexCell, HexMap, TerrainType, ResourceType } from './hexUtils'
import { MAP_COLS, MAP_ROWS } from './hexUtils'

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

function getTerrain(q: number, r: number, seed: number): TerrainType {
  const elev  = fbm(q, r, seed)
  const moist = valueNoise(q, r, seed + 500, 6)
  const river = valueNoise(q, r, seed + 300, 3)

  // Bias edges toward coast
  const edgeDist  = Math.min(q, r, MAP_COLS - 1 - q, MAP_ROWS - 1 - r)
  const coastBias = Math.max(0, 1 - edgeDist / 3) * 0.45
  const e = elev - coastBias

  if (e < 0.28) return 'coast'
  if (e < 0.48 && moist < 0.35) return 'desert'
  if (e < 0.52 && river > 0.84) return 'river'
  if (e < 0.65 && moist > 0.55) return 'forest'
  if (e < 0.72) return 'plains'
  return 'hills'
}

const RESOURCES_BY_TERRAIN: Record<TerrainType, ResourceType[]> = {
  plains: ['wheat', 'wheat', 'wheat', 'iron'],
  forest: ['wood',  'wood',  'wood',  'gems'],
  hills:  ['stone', 'stone', 'iron',  'gold', 'gems'],
  desert: ['gold',  'stone', 'gems'],
  coast:  ['fish',  'fish',  'gold'],
  river:  ['fish',  'fish',  'wheat'],
}

const RESOURCE_CHANCE: Record<TerrainType, number> = {
  plains: 0.25,
  forest: 0.35,
  hills:  0.40,
  desert: 0.15,
  coast:  0.35,
  river:  0.30,
}

function getResource(terrain: TerrainType, q: number, r: number, seed: number): ResourceType {
  if (rand01(q, r, seed + 700) > RESOURCE_CHANCE[terrain]) return null
  const opts = RESOURCES_BY_TERRAIN[terrain]
  const idx  = Math.floor(rand01(q, r, seed + 800) * opts.length)
  return opts[idx]
}

export function generateMap(worldSeed: string): HexMap {
  const seed = strToSeed(worldSeed)
  const map: HexCell[] = []
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLS; q++) {
      const terrain = getTerrain(q, r, seed)
      map.push({ q, r, terrain, resource: getResource(terrain, q, r, seed), owner: null, explored_by: [] })
    }
  }
  return map
}
