export const HEX_SIZE = 36
export const MAP_COLS = 30
export const MAP_ROWS = 20

export type TerrainType = 'plains' | 'forest' | 'hills' | 'desert' | 'coast' | 'river'
export type ResourceType = 'wheat' | 'wood' | 'stone' | 'iron' | 'gold' | 'gems' | 'fish' | null

export interface HexCell {
  q: number
  r: number
  terrain: TerrainType
  resource: ResourceType
  owner: string | null
  explored_by: string[]
}

export type HexMap = HexCell[]

export const TERRAIN_COLORS: Record<TerrainType, string> = {
  plains: '#7CB05A',
  forest: '#2D6A2D',
  hills:  '#9E7A4A',
  desert: '#C8A84B',
  coast:  '#5B9EC9',
  river:  '#4478B8',
}

export const TERRAIN_DARK: Record<TerrainType, string> = {
  plains: '#4A6B35',
  forest: '#1A3D1A',
  hills:  '#5E4828',
  desert: '#7A6429',
  coast:  '#2A5E7A',
  river:  '#1E3F6E',
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

const SQRT3 = Math.sqrt(3)

// Pointy-top hexagons, odd-r offset layout
export function hexToPixel(q: number, r: number, size = HEX_SIZE) {
  return {
    x: size * SQRT3 * (q + 0.5 * (r & 1)),
    y: size * 1.5 * r,
  }
}

export function pixelToHex(px: number, py: number, size = HEX_SIZE): { q: number; r: number } {
  // Pixel → axial fractional (pointy-top)
  const fax = (SQRT3 / 3 * px - py / 3) / size
  const far = (2 / 3 * py) / size
  // Cube fractional
  const fcx = fax, fcy = -fax - far, fcz = far
  // Cube round
  let rx = Math.round(fcx), ry = Math.round(fcy), rz = Math.round(fcz)
  const dx = Math.abs(rx - fcx), dy = Math.abs(ry - fcy), dz = Math.abs(rz - fcz)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  // Cube → odd-r offset
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

export function mapPixelSize(size = HEX_SIZE) {
  return {
    w: size * SQRT3 * (MAP_COLS + 0.5),
    h: size * (1.5 * MAP_ROWS + 0.5),
  }
}
