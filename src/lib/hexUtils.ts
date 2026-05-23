export const HEX_SIZE = 36
export const MAP_COLS = 30
export const MAP_ROWS = 20

export type TerrainType =
  | 'plains' | 'forest' | 'hills' | 'desert' | 'coast' | 'river'
  | 'mountain' | 'lake' | 'jungle' | 'steppe' | 'tundra'

export type ResourceType =
  | 'wheat' | 'wood' | 'stone' | 'iron' | 'gold' | 'gems' | 'fish'
  | null

export interface HexCell {
  q: number
  r: number
  terrain: TerrainType
  resource: ResourceType
  owner: string | null
  explored_by: string[]
}

export interface HexMapData {
  cols: number
  rows: number
  cells: HexCell[]
}

export const TERRAIN_COLORS: Record<TerrainType, string> = {
  plains:   '#7CB05A',
  forest:   '#2D6A2D',
  hills:    '#9E7A4A',
  desert:   '#C8A84B',
  coast:    '#5B9EC9',
  river:    '#4478B8',
  mountain: '#8C8C9A',
  lake:     '#3A7FC8',
  jungle:   '#1A5218',
  steppe:   '#B5A055',
  tundra:   '#A8BFCC',
}

export const TERRAIN_LABELS: Record<TerrainType, string> = {
  plains:   'Plains',
  forest:   'Forest',
  hills:    'Hills',
  desert:   'Desert',
  coast:    'Coast',
  river:    'River',
  mountain: 'Mountain',
  lake:     'Lake',
  jungle:   'Jungle',
  steppe:   'Steppe',
  tundra:   'Tundra',
}

export const RESOURCE_COLORS: Record<string, string> = {
  wheat: '#F5C518',
  wood:  '#8B5A2B',
  stone: '#9E9E9E',
  iron:  '#607D8B',
  gold:  '#FFD700',
  gems:  '#9C27B0',
  fish:  '#03A9F4',
}

export const RESOURCE_LABELS: Record<string, string> = {
  wheat: 'W',
  wood:  'T',
  stone: 'S',
  iron:  'I',
  gold:  'G',
  gems:  'J',
  fish:  'F',
}

export const RESOURCE_NAMES: Record<string, string> = {
  wheat: 'Wheat',
  wood:  'Timber',
  stone: 'Stone',
  iron:  'Iron',
  gold:  'Gold',
  gems:  'Gems',
  fish:  'Fish',
}

export const MAP_SIZE_OPTIONS = [
  { label: 'Tiny (20×13)',    cols: 20, rows: 13, civHint: '2–4 civs'  },
  { label: 'Small (25×17)',   cols: 25, rows: 17, civHint: '4–6 civs'  },
  { label: 'Standard (30×20)', cols: 30, rows: 20, civHint: '6–10 civs' },
  { label: 'Large (36×24)',   cols: 36, rows: 24, civHint: '10–16 civs' },
  { label: 'Huge (42×28)',    cols: 42, rows: 28, civHint: '16+ civs'  },
] as const

export function suggestMapSize(civCount: number) {
  if (civCount <= 4)  return MAP_SIZE_OPTIONS[0]
  if (civCount <= 6)  return MAP_SIZE_OPTIONS[1]
  if (civCount <= 10) return MAP_SIZE_OPTIONS[2]
  if (civCount <= 16) return MAP_SIZE_OPTIONS[3]
  return MAP_SIZE_OPTIONS[4]
}

const SQRT3 = Math.sqrt(3)

// Pointy-top hexagons, odd-r offset layout
export function hexToPixel(q: number, r: number, size = HEX_SIZE) {
  return {
    x: size * SQRT3 * (q + 0.5 * (r & 1)),
    y: size * 1.5 * r,
  }
}

export function pixelToHex(px: number, py: number, size = HEX_SIZE): { q: number; r: number } {
  const fax = (SQRT3 / 3 * px - py / 3) / size
  const far = (2 / 3 * py) / size
  const fcx = fax, fcy = -fax - far, fcz = far
  let rx = Math.round(fcx), ry = Math.round(fcy), rz = Math.round(fcz)
  const dx = Math.abs(rx - fcx), dy = Math.abs(ry - fcy), dz = Math.abs(rz - fcz)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { q: rx + (rz - (rz & 1)) / 2, r: rz }
}

export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size = HEX_SIZE) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 2
    const x = cx + size * Math.cos(a)
    const y = cy + size * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

export function mapPixelSize(cols = MAP_COLS, rows = MAP_ROWS, size = HEX_SIZE) {
  return {
    w: size * SQRT3 * (cols + 0.5),
    h: size * (1.5 * rows + 0.5),
  }
}

export function parseHexMapData(raw: unknown): HexMapData | null {
  if (!raw) return null
  if (Array.isArray(raw)) {
    // Legacy: flat array stored before HexMapData format
    return { cols: MAP_COLS, rows: MAP_ROWS, cells: raw as HexCell[] }
  }
  const obj = raw as Record<string, unknown>
  if (obj.cols && obj.rows && Array.isArray(obj.cells)) {
    return raw as HexMapData
  }
  return null
}

// ─── Offset odd‑r neighbours (parity deltas copied from procedural map generator) ─

/** Six adjacent coords; pass `cols`/`rows` to clamp inside the map rectangle. */
export function oddRNeighbors(
  q: number,
  r: number,
  cols?: number,
  rows?: number,
): { q: number; r: number }[] {
  const parity = r & 1
  const dirs: [number, number][] =
    parity === 0
      ? [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]]
      : [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
  const out = dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
  if (cols !== undefined && rows !== undefined) {
    return out.filter(({ q: nq, r: nr }) => nq >= 0 && nq < cols && nr >= 0 && nr < rows)
  }
  return out
}

export function getCellAt(map: HexMapData, q: number, r: number): HexCell | undefined {
  if (q < 0 || r < 0 || q >= map.cols || r >= map.rows) return undefined
  return map.cells[r * map.cols + q]
}

export function hexKey(q: number, r: number) {
  return `${q},${r}`
}

/** True if hex (tq, tr) is horizontally adjacent to any hex owned by `civId`. */
export function isAdjacentToCivOwnership(
  map: HexMapData,
  civId: string,
  tq: number,
  tr: number,
): boolean {
  for (const { q, r } of oddRNeighbors(tq, tr, map.cols, map.rows)) {
    const c = getCellAt(map, q, r)
    if (c && c.owner === civId) return true
  }
  return false
}
