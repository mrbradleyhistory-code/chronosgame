import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateMap } from '../lib/mapGen'
import {
  HEX_SIZE, MAP_COLS, MAP_ROWS,
  hexToPixel, pixelToHex, hexPath, mapPixelSize,
  TERRAIN_COLORS, RESOURCE_COLORS, RESOURCE_LABELS, RESOURCE_NAMES,
} from '../lib/hexUtils'
import type { HexCell, HexMap, TerrainType, ResourceType } from '../lib/hexUtils'

// ─── types ───────────────────────────────────────────────────────────────────

interface CivInfo { id: string; color: string; group_name: string }

interface Transform { x: number; y: number; scale: number }

interface TooltipState {
  cell: HexCell
  screenX: number
  screenY: number
  civName: string | null
}

export interface MapCanvasProps {
  viewMode: 'teacher' | 'projector' | 'student'
  gameId: string
  civId?: string
}

// ─── terrain sprite renderers ─────────────────────────────────────────────────

function drawTerrainSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  terrain: TerrainType,
) {
  const r = size * 0.3
  ctx.save()

  switch (terrain) {
    case 'plains': {
      ctx.strokeStyle = '#4A6B25'
      ctx.lineWidth = 1.5
      for (let i = -1; i <= 1; i++) {
        const sx = cx + i * r * 0.55
        ctx.beginPath()
        ctx.moveTo(sx, cy + r * 0.9)
        ctx.lineTo(sx, cy - r * 0.4)
        ctx.stroke()
        ctx.fillStyle = '#D4A843'
        ctx.beginPath()
        ctx.arc(sx, cy - r * 0.65, r * 0.18, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'forest': {
      ctx.fillStyle = '#1B5E20'
      const trees: [number, number][] = [[cx - r * 0.5, cy + r * 0.1], [cx + r * 0.5, cy + r * 0.1], [cx, cy - r * 0.15]]
      for (const [tx, ty] of trees) {
        ctx.beginPath()
        ctx.moveTo(tx, ty - r * 0.85)
        ctx.lineTo(tx - r * 0.45, ty + r * 0.35)
        ctx.lineTo(tx + r * 0.45, ty + r * 0.35)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'hills': {
      ctx.fillStyle = '#6D4C41'
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath()
        ctx.arc(cx + i * r * 0.48, cy + r * 0.3, r * 0.52, Math.PI, 0)
        ctx.closePath()
        ctx.fill()
      }
      // Snow cap highlight
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath()
        ctx.arc(cx + i * r * 0.48, cy + r * 0.3, r * 0.52, Math.PI, Math.PI * 1.6)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'desert': {
      ctx.fillStyle = '#F57F17'
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.1, r * 0.28, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#F57F17'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r * 0.42, cy - r * 0.1 + Math.sin(a) * r * 0.42)
        ctx.lineTo(cx + Math.cos(a) * r * 0.62, cy - r * 0.1 + Math.sin(a) * r * 0.62)
        ctx.stroke()
      }
      break
    }
    case 'coast': {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 2
      for (let i = -1; i <= 1; i++) {
        const wy = cy + i * r * 0.5
        ctx.beginPath()
        ctx.moveTo(cx - r, wy)
        ctx.bezierCurveTo(cx - r * 0.5, wy - r * 0.28, cx + r * 0.5, wy + r * 0.28, cx + r, wy)
        ctx.stroke()
      }
      break
    }
    case 'river': {
      ctx.strokeStyle = 'rgba(144,202,249,0.9)'
      ctx.lineWidth = 2.5
      for (let i = -1; i <= 1; i++) {
        const wy = cy + i * r * 0.45
        ctx.beginPath()
        ctx.moveTo(cx - r, wy)
        ctx.quadraticCurveTo(cx, wy - r * 0.22, cx + r, wy)
        ctx.stroke()
      }
      break
    }
  }
  ctx.restore()
}

// ─── resource badge ───────────────────────────────────────────────────────────

function drawResourceBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  resource: NonNullable<ResourceType>,
) {
  const bx = cx + size * 0.52
  const by = cy + size * 0.52
  const br = size * 0.2
  ctx.save()
  ctx.fillStyle = RESOURCE_COLORS[resource] ?? '#888'
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(br * 1.15)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(RESOURCE_LABELS[resource] ?? '?', bx, by)
  ctx.restore()
}

// ─── full draw routine ────────────────────────────────────────────────────────

function drawMap(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  map: HexMap,
  civs: CivInfo[],
  transform: Transform,
  viewMode: 'teacher' | 'projector' | 'student',
  civId: string | undefined,
  selectedQ: number | null,
  selectedR: number | null,
) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Dark background
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  for (const cell of map) {
    const { x: cx, y: cy } = hexToPixel(cell.q, cell.r)
    const visible = viewMode !== 'student' || cell.explored_by.includes(civId ?? '')

    if (!visible) {
      // Fog of war
      hexPath(ctx, cx, cy)
      ctx.fillStyle = '#111827'
      ctx.fill()
      hexPath(ctx, cx, cy)
      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = 1
      ctx.stroke()
      continue
    }

    // Terrain fill
    hexPath(ctx, cx, cy)
    ctx.fillStyle = TERRAIN_COLORS[cell.terrain]
    ctx.fill()

    // Terrain sprite
    drawTerrainSprite(ctx, cx, cy, HEX_SIZE, cell.terrain)

    // Resource badge
    if (cell.resource) drawResourceBadge(ctx, cx, cy, HEX_SIZE, cell.resource)

    // Owner overlay
    if (cell.owner) {
      const civ = civs.find(c => c.id === cell.owner)
      if (civ) {
        hexPath(ctx, cx, cy)
        ctx.fillStyle = civ.color + '50'
        ctx.fill()
        hexPath(ctx, cx, cy)
        ctx.strokeStyle = civ.color
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Default border
    if (!cell.owner) {
      hexPath(ctx, cx, cy)
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // Selected hex highlight
  if (selectedQ !== null && selectedR !== null) {
    const { x: cx, y: cy } = hexToPixel(selectedQ, selectedR)
    hexPath(ctx, cx, cy)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.5
    ctx.stroke()
  }

  ctx.restore()
}

// ─── component ────────────────────────────────────────────────────────────────

export function MapCanvas({ viewMode, gameId, civId }: MapCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep mutable rendering state in refs to avoid stale closures in event handlers
  const transformRef   = useRef<Transform>({ x: 0, y: 0, scale: 1 })
  const mapRef         = useRef<HexMap>([])
  const civsRef        = useRef<CivInfo[]>([])
  const selectedRef    = useRef<{ q: number; r: number } | null>(null)
  const viewModeRef    = useRef(viewMode)
  const civIdRef       = useRef(civId)
  const rafRef         = useRef(0)
  const isDragging     = useRef(false)
  const dragStart      = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const hasMoved       = useRef(false)

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tooltip, setTooltip]   = useState<TooltipState | null>(null)

  // Keep refs synced
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
  useEffect(() => { civIdRef.current    = civId    }, [civId])

  // ── render ──
  const redraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const sel = selectedRef.current
      drawMap(
        ctx, canvas,
        mapRef.current, civsRef.current,
        transformRef.current,
        viewModeRef.current, civIdRef.current,
        sel?.q ?? null, sel?.r ?? null,
      )
    })
  }, [])

  // ── resize canvas to container ──
  const syncSize = useCallback(() => {
    const canvas    = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const { width, height } = container.getBoundingClientRect()
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width  = width
      canvas.height = height
    }
    redraw()
  }, [redraw])

  // ── center map in canvas ──
  const centerMap = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w, h } = mapPixelSize()
    const scale = Math.min((canvas.width / w) * 0.92, (canvas.height / h) * 0.92, 1)
    transformRef.current = {
      x: (canvas.width  - w * scale) / 2,
      y: (canvas.height - h * scale) / 2,
      scale,
    }
    redraw()
  }, [redraw])

  // ── load game data ──
  useEffect(() => {
    if (!gameId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      // Try fetching with hex_map; fall back if the column doesn't exist yet
      let worldSeed: string | null = null
      let storedMap: HexMap | null = null
      let hexMapColumnExists = true

      const { data: game, error: gameErr } = await supabase
        .from('games')
        .select('world_seed, hex_map')
        .eq('id', gameId)
        .single()

      if (cancelled) return

      if (gameErr) {
        if (gameErr.message.includes('hex_map')) {
          // Migration not yet applied — fetch without hex_map
          hexMapColumnExists = false
          const { data: gameBasic, error: basicErr } = await supabase
            .from('games')
            .select('world_seed')
            .eq('id', gameId)
            .single()
          if (cancelled) return
          if (basicErr) { setError(basicErr.message); setLoading(false); return }
          worldSeed = (gameBasic as { world_seed: string | null }).world_seed
        } else {
          setError(gameErr.message)
          setLoading(false)
          return
        }
      } else {
        const g = game as { world_seed: string | null; hex_map: HexMap | null }
        worldSeed = g.world_seed
        storedMap = g.hex_map
      }

      // Fetch civs for this game
      const { data: civRows } = await supabase
        .from('civilizations')
        .select('id, color, group_name')
        .eq('game_id', gameId)

      if (cancelled) return
      civsRef.current = (civRows ?? []) as CivInfo[]

      let hexMap: HexMap | null = storedMap

      if (!hexMap) {
        // Generate from seed (or fallback to gameId as seed)
        const seed = worldSeed ?? gameId
        hexMap = generateMap(seed)

        // Only persist if teacher and the column exists
        if (viewMode === 'teacher' && hexMapColumnExists) {
          await supabase
            .from('games')
            .update({ hex_map: hexMap })
            .eq('id', gameId)
        }
      }

      if (cancelled) return
      mapRef.current = hexMap
      setLoading(false)
      // Center after first load
      setTimeout(centerMap, 0)
    }

    load()
    return () => { cancelled = true }
  }, [gameId, viewMode, centerMap])

  // ── ResizeObserver ──
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [syncSize])

  // ── pan / zoom / click ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect  = canvas!.getBoundingClientRect()
      const mx    = e.clientX - rect.left
      const my    = e.clientY - rect.top
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const t     = transformRef.current
      const newScale = Math.max(0.25, Math.min(4, t.scale * delta))
      transformRef.current = {
        scale: newScale,
        x: mx - (mx - t.x) * (newScale / t.scale),
        y: my - (my - t.y) * (newScale / t.scale),
      }
      redraw()
    }

    function onMouseDown(e: MouseEvent) {
      isDragging.current = true
      hasMoved.current   = false
      dragStart.current  = { x: e.clientX, y: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y }
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true
      transformRef.current = { ...transformRef.current, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }
      redraw()
    }

    function onMouseUp(e: MouseEvent) {
      isDragging.current = false
      if (hasMoved.current) return

      // Treat as click → find hex
      const rect   = canvas!.getBoundingClientRect()
      const sx     = e.clientX - rect.left
      const sy     = e.clientY - rect.top
      const t      = transformRef.current
      const mapX   = (sx - t.x) / t.scale
      const mapY   = (sy - t.y) / t.scale
      const { q, r } = pixelToHex(mapX, mapY)

      if (q < 0 || q >= MAP_COLS || r < 0 || r >= MAP_ROWS) {
        selectedRef.current = null
        setTooltip(null)
        redraw()
        return
      }

      const cell = mapRef.current[r * MAP_COLS + q]
      if (!cell) return

      selectedRef.current = { q, r }
      const civ = civsRef.current.find(c => c.id === cell.owner)
      const isVisible = viewModeRef.current !== 'student' || cell.explored_by.includes(civIdRef.current ?? '')
      setTooltip(isVisible ? { cell, screenX: sx, screenY: sy, civName: civ?.group_name ?? null } : null)
      redraw()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [redraw])

  // ── tooltip helpers ──
  function terrainLabel(t: TerrainType) {
    return t.charAt(0).toUpperCase() + t.slice(1)
  }

  return (
    <div ref={containerRef} className="relative w-full h-full select-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
          <p className="text-slate-400 text-sm animate-pulse">Generating world…</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Legend */}
      {!loading && viewMode !== 'projector' && (
        <div className="absolute top-2 right-2 rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-xs space-y-1 pointer-events-none">
          {(['plains','forest','hills','desert','coast','river'] as const).map(t => (
            <div key={t} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: TERRAIN_COLORS[t] }} />
              <span className="text-slate-400 capitalize">{t}</span>
            </div>
          ))}
          <div className="border-t border-slate-700 pt-1 text-slate-500">
            Scroll to zoom · drag to pan
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 rounded-lg border border-slate-600 bg-slate-900/95 p-3 shadow-xl text-sm min-w-[150px]"
          style={{
            left: Math.min(tooltip.screenX + 12, (containerRef.current?.clientWidth ?? 999) - 180),
            top:  Math.min(tooltip.screenY + 12, (containerRef.current?.clientHeight ?? 999) - 120),
          }}
        >
          <p className="font-semibold text-white capitalize">{terrainLabel(tooltip.cell.terrain)}</p>
          {tooltip.cell.resource && (
            <p className="text-slate-300 mt-0.5">
              <span className="text-slate-500">Resource: </span>
              {RESOURCE_NAMES[tooltip.cell.resource] ?? tooltip.cell.resource}
            </p>
          )}
          {tooltip.civName && (
            <p className="text-slate-300 mt-0.5">
              <span className="text-slate-500">Owner: </span>
              {tooltip.civName}
            </p>
          )}
          {viewMode === 'teacher' && (
            <p className="text-slate-600 mt-1 text-xs">
              ({tooltip.cell.q}, {tooltip.cell.r})
            </p>
          )}
        </div>
      )}
    </div>
  )
}
