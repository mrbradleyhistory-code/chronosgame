import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateMap } from '../lib/mapGen'
import { applyCivSpawnsToGameMap } from '../lib/ensureGameMapSpawns'
import { findCivCapital } from '../lib/civPlacement'
import { fetchGameCivRoster } from '../lib/gameCivRoster'
import {
  HEX_SIZE,
  hexToPixel, pixelToHex, hexPath, mapPixelSize, parseHexMapData,
  TERRAIN_COLORS, TERRAIN_LABELS, RESOURCE_COLORS, RESOURCE_LABELS, RESOURCE_NAMES,
  MAP_COLS, MAP_ROWS, countExploredForCiv,
} from '../lib/hexUtils'
import type { HexCell, HexMapData, TerrainType, ResourceType } from '../lib/hexUtils'

// ─── types ────────────────────────────────────────────────────────────────────

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
  /** Fallback when roster RPC/direct select is empty (student PIN session). */
  playerCiv?: { id: string; color: string; group_name: string }
  // Teacher regen: if provided, the map is loaded from this data instead of DB
  previewMap?: HexMapData | null
  // Called after map is fetched/generated so teacher can inspect it
  onMapLoaded?: (map: HexMapData) => void
  /** Invoked whenever a learner selects a explored hex tile (for decree targeting). */
  onStudentHexPick?: (cell: HexCell) => void
  /** Fired after map load + spawn repair — use to sync map state in parent. */
  onStudentMapReady?: (map: HexMapData, civId: string) => void
  /** Hex keys (q,r) highlighted as valid EXPAND targets; fog tiles in this set remain clickable. */
  expandTargetKeys?: Set<string>
}

// ─── terrain sprite renderers ─────────────────────────────────────────────────

function drawTerrainSprite(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
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
        ctx.beginPath(); ctx.moveTo(sx, cy + r * 0.9); ctx.lineTo(sx, cy - r * 0.4); ctx.stroke()
        ctx.fillStyle = '#D4A843'
        ctx.beginPath(); ctx.arc(sx, cy - r * 0.65, r * 0.18, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'forest': {
      ctx.fillStyle = '#1B5E20'
      const trees: [number, number][] = [[cx - r * 0.5, cy + r * 0.1], [cx + r * 0.5, cy + r * 0.1], [cx, cy - r * 0.15]]
      for (const [tx, ty] of trees) {
        ctx.beginPath()
        ctx.moveTo(tx, ty - r * 0.85); ctx.lineTo(tx - r * 0.45, ty + r * 0.35); ctx.lineTo(tx + r * 0.45, ty + r * 0.35)
        ctx.closePath(); ctx.fill()
      }
      break
    }
    case 'hills': {
      ctx.fillStyle = '#6D4C41'
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.arc(cx + i * r * 0.48, cy + r * 0.3, r * 0.52, Math.PI, 0); ctx.closePath(); ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath(); ctx.arc(cx + i * r * 0.48, cy + r * 0.3, r * 0.52, Math.PI, Math.PI * 1.6); ctx.closePath(); ctx.fill()
      }
      break
    }
    case 'mountain': {
      // Two jagged peaks with snow caps
      const peaks: [number, number, number][] = [[cx - r * 0.4, cy + r * 0.7, r * 0.6], [cx + r * 0.35, cy + r * 0.7, r * 0.75]]
      ctx.fillStyle = '#757575'
      for (const [px, py, pr] of peaks) {
        ctx.beginPath()
        ctx.moveTo(px, py - pr); ctx.lineTo(px - pr * 0.7, py + pr * 0.4); ctx.lineTo(px + pr * 0.7, py + pr * 0.4)
        ctx.closePath(); ctx.fill()
      }
      // Snow caps
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      for (const [px, py, pr] of peaks) {
        ctx.beginPath()
        ctx.moveTo(px, py - pr); ctx.lineTo(px - pr * 0.28, py - pr * 0.55); ctx.lineTo(px + pr * 0.28, py - pr * 0.55)
        ctx.closePath(); ctx.fill()
      }
      break
    }
    case 'desert': {
      ctx.fillStyle = '#F57F17'
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 0.28, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#F57F17'; ctx.lineWidth = 1.5
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
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2
      for (let i = -1; i <= 1; i++) {
        const wy = cy + i * r * 0.5
        ctx.beginPath()
        ctx.moveTo(cx - r, wy); ctx.bezierCurveTo(cx - r * 0.5, wy - r * 0.28, cx + r * 0.5, wy + r * 0.28, cx + r, wy)
        ctx.stroke()
      }
      break
    }
    case 'river': {
      ctx.strokeStyle = 'rgba(144,202,249,0.9)'; ctx.lineWidth = 2.5
      for (let i = -1; i <= 1; i++) {
        const wy = cy + i * r * 0.45
        ctx.beginPath(); ctx.moveTo(cx - r, wy); ctx.quadraticCurveTo(cx, wy - r * 0.22, cx + r, wy); ctx.stroke()
      }
      break
    }
    case 'lake': {
      // Concentric calm ovals
      for (let i = 0; i < 3; i++) {
        const sc = 1 - i * 0.28
        ctx.strokeStyle = `rgba(255,255,255,${0.5 - i * 0.12})`; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.8 * sc, r * 0.5 * sc, 0, 0, Math.PI * 2); ctx.stroke()
      }
      break
    }
    case 'jungle': {
      // Dense canopy: overlapping dark circles
      const canopy: [number, number, number][] = [
        [cx, cy - r * 0.5, r * 0.42],
        [cx - r * 0.48, cy + r * 0.1, r * 0.38],
        [cx + r * 0.48, cy + r * 0.1, r * 0.38],
        [cx, cy + r * 0.45, r * 0.34],
      ]
      ctx.fillStyle = '#2E7D32'
      for (const [bx, by, br] of canopy) {
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = '#1B5E20'
      for (const [bx, by, br] of canopy.slice(0, 2)) {
        ctx.beginPath(); ctx.arc(bx, by, br * 0.55, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'steppe': {
      // Sparse scattered tufts
      ctx.fillStyle = '#8D6E28'
      const tufts: [number, number][] = [[cx - r * 0.55, cy + r * 0.3], [cx, cy - r * 0.1], [cx + r * 0.5, cy + r * 0.5], [cx - r * 0.2, cy + r * 0.7]]
      for (const [tx, ty] of tufts) {
        ctx.beginPath(); ctx.arc(tx, ty, r * 0.12, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#A0874A'; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - r * 0.08, ty - r * 0.32)
        ctx.moveTo(tx, ty); ctx.lineTo(tx + r * 0.08, ty - r * 0.28); ctx.stroke()
      }
      break
    }
    case 'tundra': {
      // Snowflake / ice crystal pattern
      ctx.strokeStyle = 'rgba(200,230,255,0.85)'; ctx.lineWidth = 1.5
      const arms = 6
      for (let i = 0; i < arms; i++) {
        const a = (Math.PI / arms) * i
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7)
        ctx.lineTo(cx - Math.cos(a) * r * 0.7, cy - Math.sin(a) * r * 0.7)
        ctx.stroke()
        // cross bars
        for (const frac of [0.35, -0.35]) {
          const bx = cx + Math.cos(a) * r * frac, by = cy + Math.sin(a) * r * frac
          const perp = a + Math.PI / 2
          ctx.beginPath()
          ctx.moveTo(bx + Math.cos(perp) * r * 0.22, by + Math.sin(perp) * r * 0.22)
          ctx.lineTo(bx - Math.cos(perp) * r * 0.22, by - Math.sin(perp) * r * 0.22)
          ctx.stroke()
        }
      }
      break
    }
  }
  ctx.restore()
}

// ─── resource badge ───────────────────────────────────────────────────────────

function drawResourceBadge(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number,
  resource: NonNullable<ResourceType>,
) {
  const bx = cx + size * 0.52, by = cy + size * 0.52, br = size * 0.2
  ctx.save()
  ctx.fillStyle = RESOURCE_COLORS[resource] ?? '#888'
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(br * 1.15)}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(RESOURCE_LABELS[resource] ?? '?', bx, by)
  ctx.restore()
}

function cellVisibleForStudent(cell: HexCell, civId: string | undefined): boolean {
  if (!civId) return false
  const seen = cell.explored_by
  return Array.isArray(seen) && seen.includes(civId)
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  mapData: HexMapData,
  civs: CivInfo[],
  transform: Transform,
  viewMode: 'teacher' | 'projector' | 'student',
  civId: string | undefined,
  selectedQ: number | null,
  selectedR: number | null,
  expandTargetKeys: Set<string> | undefined,
) {
  const { cols, rows, cells } = mapData
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  const showAllTerritory = viewMode === 'teacher' || viewMode === 'projector'
  const ownerFillAlpha = showAllTerritory ? '88' : '50'
  const ownerStrokeWidth = showAllTerritory ? 2.5 : 2

  for (const cell of cells) {
    const { x: cx, y: cy } = hexToPixel(cell.q, cell.r)
    const visible = viewMode !== 'student' || cellVisibleForStudent(cell, civId)
    const isExpandTarget = expandTargetKeys?.has(`${cell.q},${cell.r}`) ?? false

    if (!visible) {
      hexPath(ctx, cx, cy)
      ctx.fillStyle = isExpandTarget ? '#1a3a2a' : '#111827'
      ctx.fill()
      hexPath(ctx, cx, cy)
      ctx.strokeStyle = isExpandTarget ? '#34d399' : '#1f2937'
      ctx.lineWidth = isExpandTarget ? 2 : 1
      ctx.stroke()
      if (isExpandTarget) {
        hexPath(ctx, cx, cy)
        ctx.strokeStyle = 'rgba(52,211,153,0.55)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
      continue
    }

    hexPath(ctx, cx, cy)
    ctx.fillStyle = TERRAIN_COLORS[cell.terrain]; ctx.fill()

    drawTerrainSprite(ctx, cx, cy, HEX_SIZE, cell.terrain)

    if (cell.resource) drawResourceBadge(ctx, cx, cy, HEX_SIZE, cell.resource)

    if (cell.owner) {
      const civ = civs.find(c => c.id === cell.owner)
      const ownerColor = civ?.color ?? '#94a3b8'
      hexPath(ctx, cx, cy)
      ctx.fillStyle = ownerColor + ownerFillAlpha
      ctx.fill()
      hexPath(ctx, cx, cy)
      ctx.strokeStyle = ownerColor
      ctx.lineWidth = ownerStrokeWidth
      ctx.stroke()
    }

    if (isExpandTarget) {
      hexPath(ctx, cx, cy)
      ctx.strokeStyle = '#34d399'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    if (!cell.owner) {
      hexPath(ctx, cx, cy); ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1; ctx.stroke()
    }
  }

  // Selected hex highlight
  if (selectedQ !== null && selectedR !== null) {
    const { x: cx, y: cy } = hexToPixel(selectedQ, selectedR)
    hexPath(ctx, cx, cy); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.stroke()
  }

  ctx.restore()

  // Unused cols/rows to satisfy lint
  void cols; void rows
}

// ─── component ────────────────────────────────────────────────────────────────

export function MapCanvas({
  viewMode,
  gameId,
  civId,
  playerCiv,
  previewMap,
  onMapLoaded,
  onStudentHexPick,
  onStudentMapReady,
  expandTargetKeys,
}: MapCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 })
  const mapRef       = useRef<HexMapData>({ cols: MAP_COLS, rows: MAP_ROWS, cells: [] })
  const civsRef      = useRef<CivInfo[]>([])
  const selectedRef  = useRef<{ q: number; r: number } | null>(null)
  const viewModeRef  = useRef(viewMode)
  const civIdRef     = useRef(civId)
  const playerCivRef = useRef(playerCiv)
  const hexPickRef   = useRef(onStudentHexPick)
  const mapReadyRef  = useRef(onStudentMapReady)
  const expandKeysRef = useRef(expandTargetKeys)
  const rafRef       = useRef(0)
  const isDragging   = useRef(false)
  const dragStart    = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const hasMoved     = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [mapHint, setMapHint] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [civLegend, setCivLegend] = useState<CivInfo[]>([])

  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
  useEffect(() => { civIdRef.current    = civId    }, [civId])
  useEffect(() => { playerCivRef.current = playerCiv }, [playerCiv])
  useEffect(() => { hexPickRef.current = onStudentHexPick }, [onStudentHexPick])
  useEffect(() => { mapReadyRef.current = onStudentMapReady }, [onStudentMapReady])
  useEffect(() => { expandKeysRef.current = expandTargetKeys }, [expandTargetKeys])

  // ── render ──
  const redraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current; if (!canvas) return
      const ctx = canvas.getContext('2d'); if (!ctx) return
      const sel = selectedRef.current
      drawMap(ctx, canvas, mapRef.current, civsRef.current, transformRef.current,
        viewModeRef.current, civIdRef.current, sel?.q ?? null, sel?.r ?? null,
        expandKeysRef.current)
    })
  }, [])

  useEffect(() => { redraw() }, [expandTargetKeys, redraw])

  // ── center map ──
  const centerMap = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const { cols, rows } = mapRef.current
    const { w, h } = mapPixelSize(cols, rows)
    const scale = Math.min((canvas.width / w) * 0.92, (canvas.height / h) * 0.92, 1)
    transformRef.current = { x: (canvas.width - w * scale) / 2, y: (canvas.height - h * scale) / 2, scale }
    redraw()
  }, [redraw])

  const centerOnHex = useCallback(
    (q: number, r: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { x: hx, y: hy } = hexToPixel(q, r)
      const scale = Math.max(0.55, Math.min(transformRef.current.scale || 0.85, 1.25))
      transformRef.current = {
        scale,
        x: canvas.width / 2 - hx * scale,
        y: canvas.height / 2 - hy * scale,
      }
      redraw()
    },
    [redraw],
  )

  // ── resize ──
  const syncSize = useCallback(() => {
    const canvas = canvasRef.current, container = containerRef.current
    if (!canvas || !container) return
    const { width, height } = container.getBoundingClientRect()
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    redraw()
  }, [redraw])

  // ── apply previewMap when teacher provides one ──
  useEffect(() => {
    if (!previewMap) return
    mapRef.current = previewMap
    setLoading(false)
    setError(null)
    setTimeout(centerMap, 0)
  }, [previewMap, centerMap])

  // ── load from DB (only when no previewMap) ──
  useEffect(() => {
    if (!gameId || previewMap) return
    let cancelled = false

    async function load() {
      setLoading(true); setError(null)

      // Try fetching with hex_map
      let worldSeed: string | null = null
      let stored: HexMapData | null = null
      let hexColExists = true

      const { data: game, error: gameErr } = await supabase
        .from('games').select('world_seed, hex_map').eq('id', gameId).single()

      if (cancelled) return

      if (gameErr) {
        if (gameErr.message.includes('hex_map')) {
          hexColExists = false
          const { data: g2, error: e2 } = await supabase
            .from('games').select('world_seed').eq('id', gameId).single()
          if (cancelled) return
          if (e2) { setError(e2.message); setLoading(false); return }
          worldSeed = (g2 as { world_seed: string | null }).world_seed
        } else {
          setError(gameErr.message); setLoading(false); return
        }
      } else {
        const g = game as { world_seed: string | null; hex_map: unknown }
        worldSeed = g.world_seed
        stored = parseHexMapData(g.hex_map)
      }

      const roster = await fetchGameCivRoster(gameId)
      if (cancelled) return

      let civList: CivInfo[] = roster
      if (civList.length === 0 && playerCivRef.current) {
        civList = [playerCivRef.current]
      } else if (civIdRef.current && !civList.some((c) => c.id === civIdRef.current) && playerCivRef.current) {
        civList = [...civList, playerCivRef.current]
      }

      civsRef.current = civList
      setCivLegend(civList)
      const civIds = civList.map((c) => c.id)
      if (civIds.length === 0 && civIdRef.current) {
        civIds.push(civIdRef.current)
      }

      let hexMap = stored
      if (!hexMap) {
        hexMap = generateMap(worldSeed ?? gameId)
        if (viewMode === 'teacher' && hexColExists) {
          await supabase.from('games').update({ hex_map: hexMap }).eq('id', gameId)
        }
      }

      hexMap = await applyCivSpawnsToGameMap(
        gameId,
        hexMap,
        civIds,
        worldSeed ?? gameId,
        hexColExists,
        civIdRef.current,
      )

      if (cancelled) return
      mapRef.current = hexMap
      onMapLoaded?.(hexMap)

      const focus = civIdRef.current
      if (viewMode === 'student' && focus) {
        const visible = countExploredForCiv(hexMap, focus)
        if (visible === 0) {
          setMapHint('Your starting territory is not on the map yet. Ask your teacher to start the game and lock a world map, then refresh.')
        } else {
          setMapHint(null)
          mapReadyRef.current?.(hexMap, focus)
        }
      } else {
        setMapHint(null)
      }

      setLoading(false)

      if (viewMode === 'student' && civId) {
        const cap = findCivCapital(hexMap, civId)
        setTimeout(() => (cap ? centerOnHex(cap.q, cap.r) : centerMap()), 0)
      } else {
        setTimeout(centerMap, 0)
      }
    }

    load()
    return () => { cancelled = true }
  }, [gameId, viewMode, previewMap, centerMap, centerOnHex, civId, onMapLoaded])

  // Reload hex_map when the game row updates (turn advance, territory changes).
  useEffect(() => {
    if (!gameId || previewMap) return undefined

    const channel = supabase
      .channel(`map-sync-${gameId}-${viewMode}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const fresh = parseHexMapData((payload.new as { hex_map?: unknown }).hex_map)
          if (!fresh) return
          mapRef.current = fresh
          onMapLoaded?.(fresh)
          redraw()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [gameId, previewMap, viewMode, onMapLoaded, redraw])

  // ── ResizeObserver ──
  useEffect(() => {
    const container = containerRef.current; if (!container) return
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [syncSize])

  // ── pan / zoom / click ──
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = canvas!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const t = transformRef.current
      const newScale = Math.max(0.2, Math.min(5, t.scale * delta))
      transformRef.current = { scale: newScale, x: mx - (mx - t.x) * (newScale / t.scale), y: my - (my - t.y) * (newScale / t.scale) }
      redraw()
    }

    function onMouseDown(e: MouseEvent) {
      isDragging.current = true; hasMoved.current = false
      dragStart.current = { x: e.clientX, y: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y }
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return
      const dx = e.clientX - dragStart.current.x, dy = e.clientY - dragStart.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true
      transformRef.current = { ...transformRef.current, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }
      redraw()
    }

    function onMouseUp(e: MouseEvent) {
      isDragging.current = false
      if (hasMoved.current) return

      const rect = canvas!.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      const t = transformRef.current
      const { q, r } = pixelToHex((sx - t.x) / t.scale, (sy - t.y) / t.scale)

      const { cols, rows } = mapRef.current
      if (q < 0 || q >= cols || r < 0 || r >= rows) {
        selectedRef.current = null; setTooltip(null); redraw(); return
      }

      const cell = mapRef.current.cells[r * cols + q]
      if (!cell) return

      selectedRef.current = { q, r }
      const isVisible =
        viewModeRef.current !== 'student' || cellVisibleForStudent(cell, civIdRef.current)
      const expandPick = expandKeysRef.current?.has(`${q},${r}`) ?? false
      if (viewModeRef.current === 'student' && (isVisible || expandPick)) {
        hexPickRef.current?.(cell)
      }
      const civ = civsRef.current.find(c => c.id === cell.owner)
      const container = containerRef.current
      setTooltip(isVisible || expandPick ? {
        cell, civName: civ?.group_name ?? null,
        screenX: Math.min(sx + 12, (container?.clientWidth ?? 999) - 180),
        screenY: Math.min(sy + 12, (container?.clientHeight ?? 999) - 120),
      } : null)
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

      {mapHint && !loading && viewMode === 'student' && (
        <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-amber-700/60 bg-amber-950/90 px-3 py-2 text-xs text-amber-100 pointer-events-none z-10">
          {mapHint}
        </div>
      )}

      {/* Territory legend (teacher / projector) */}
      {!loading && (viewMode === 'teacher' || viewMode === 'projector') && civLegend.length > 0 && (
        <div className="absolute bottom-2 left-2 rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-xs space-y-1 pointer-events-none max-w-[14rem]">
          <p className="text-slate-500 font-medium uppercase tracking-wide text-[10px]">Territory</p>
          {civLegend.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ backgroundColor: c.color }} />
              <span className="text-slate-300 truncate">{c.group_name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {!loading && viewMode !== 'projector' && (
        <div className="absolute top-2 right-2 rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-xs space-y-0.5 pointer-events-none">
          {(Object.keys(TERRAIN_COLORS) as TerrainType[]).map(t => (
            <div key={t} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: TERRAIN_COLORS[t] }} />
              <span className="text-slate-400">{TERRAIN_LABELS[t]}</span>
            </div>
          ))}
          <div className="border-t border-slate-700 pt-1 text-slate-600">Scroll · drag to navigate</div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 rounded-lg border border-slate-600 bg-slate-900/95 p-3 shadow-xl text-sm min-w-[150px]"
          style={{ left: tooltip.screenX, top: tooltip.screenY }}
        >
          <p className="font-semibold text-white">{TERRAIN_LABELS[tooltip.cell.terrain]}</p>
          {tooltip.cell.resource && (
            <p className="text-slate-300 mt-0.5">
              <span className="text-slate-500">Resource: </span>{RESOURCE_NAMES[tooltip.cell.resource]}
            </p>
          )}
          {tooltip.civName && (
            <p className="text-slate-300 mt-0.5">
              <span className="text-slate-500">Owner: </span>{tooltip.civName}
            </p>
          )}
          {viewMode === 'teacher' && (
            <p className="text-slate-600 mt-1 text-xs">({tooltip.cell.q}, {tooltip.cell.r})</p>
          )}
        </div>
      )}
    </div>
  )
}
