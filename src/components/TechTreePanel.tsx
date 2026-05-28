import { useMemo } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { TechDefinition } from '../types/techTree'
import {
  TECH_DEFINITIONS,
  TECH_ERA_DETAILS,
  computeTechNodeStatus,
  eraOpensOnTurn,
  summarizeBonusLine,
  techLayoutCoordinates,
} from '../lib/techTree'

interface TechTreePanelProps {
  researchedIds: string[]
  calendarTurn: number
  knowledge: number
  /** Sync with RESEARCH decree payload */
  selectedTechId?: string
  /** Select a mastery for scholarship slot */
  onSelectTech?: (techId: string) => void
  /** Dark sidebar styling when nested in student action queue */
  embedded?: boolean
}

function directiveLine(def: TechDefinition): string[] {
  const bits: string[] = []
  if (def.unlockedActions?.includes('EXPLORE')) bits.push('unlocks Exploration decree')
  if (def.unlockedBuildings?.length) bits.push(`unlocks blueprint: ${def.unlockedBuildings.join(', ')}`)
  return bits
}

function nodePaint(status: ReturnType<typeof computeTechNodeStatus>): {
  rim: string
  fill: string
  glyph: string
} {
  switch (status) {
    case 'researched':
      return { rim: '#3d5530', fill: 'rgba(70,108,62,0.55)', glyph: '#d8eabe' }
    case 'available':
      return { rim: '#c9a047', fill: 'rgba(120,90,42,0.45)', glyph: '#f6e9c8' }
    case 'locked_turn':
    case 'locked_missing_prereqs':
      return { rim: '#4a463c', fill: 'rgba(35,34,31,0.55)', glyph: '#7b7568' }
    default:
      return { rim: '#555', fill: '#333', glyph: '#999' }
  }
}

/** Stone tablet syllabus — SVG nodes + etched prerequisite paths. */
export function TechTreePanel({
  researchedIds,
  calendarTurn,
  knowledge,
  selectedTechId,
  onSelectTech,
  embedded = false,
}: TechTreePanelProps): ReactElement {
  const researchedSet = useMemo(() => new Set(researchedIds), [researchedIds])

  const edges = useMemo(() => {
    const out: { key: string; x1: number; y1: number; x2: number; y2: number; dim: boolean }[] = []
    for (const child of TECH_DEFINITIONS) {
      const cdest = techLayoutCoordinates(child.id)
      for (const pre of child.prerequisites) {
        const cord = techLayoutCoordinates(pre)
        const parentRes = researchedSet.has(pre)
        const childRes = researchedSet.has(child.id)
        out.push({
          key: `${pre}>${child.id}`,
          x1: cord.x,
          y1: cord.y,
          x2: cdest.x,
          y2: cdest.y,
          dim: !parentRes && !childRes,
        })
      }
    }
    return out
  }, [researchedSet])

  return (
    <div className={embedded ? 'rounded-lg border border-slate-700 bg-slate-900/40 p-2' : 'tech-tree-wrap'}>
      <div className={embedded ? 'px-1 pb-2' : 'tech-tree-caption'}>
        <p className={embedded ? 'text-xs font-semibold text-slate-300' : 'tech-tree-caption-title'}>
          Technology tree
        </p>
        <p className={embedded ? 'text-[11px] text-slate-500 mt-1 leading-relaxed' : 'tech-tree-caption-meta'}>
          Century {calendarTurn} · {knowledge} knowledge stored. Gold nodes can be researched; grey nodes need prerequisites
          or a later century.
        </p>
      </div>

      <div className={embedded ? 'rounded-md border border-slate-600 bg-slate-950/80 overflow-hidden' : 'tech-tree-svg-frame'}>
        <svg
          role="img"
          aria-label="Technology tree spanning Bronze, Iron, and Classical eras"
          viewBox="0 0 928 392"
          className="tech-tree-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="tech-era-bronze" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(90,74,54,0.35)" />
              <stop offset="100%" stopColor="rgba(40,34,26,0.12)" />
            </linearGradient>
            <linearGradient id="tech-era-iron" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(70,82,94,0.28)" />
              <stop offset="100%" stopColor="rgba(32,38,42,0.1)" />
            </linearGradient>
            <linearGradient id="tech-era-classic" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(118,94,74,0.32)" />
              <stop offset="100%" stopColor="rgba(48,38,28,0.1)" />
            </linearGradient>
          </defs>

          <rect className="tech-tree-era-band" data-era="bronze" x={8} y={12} width={292} height={368} rx={6} fill="url(#tech-era-bronze)" stroke="rgba(218,184,118,0.25)" strokeWidth={1} />
          <rect className="tech-tree-era-band" data-era="iron" x={316} y={12} width={292} height={368} rx={6} fill="url(#tech-era-iron)" stroke="rgba(218,184,118,0.22)" strokeWidth={1} />
          <rect className="tech-tree-era-band" data-era="classical" x={624} y={12} width={292} height={368} rx={6} fill="url(#tech-era-classic)" stroke="rgba(218,184,118,0.22)" strokeWidth={1} />

          {TECH_ERA_DETAILS.map((band, idx) => {
            const lx = idx === 0 ? 78 : idx === 1 ? 386 : 694
            return (
              <text
                key={band.id}
                x={lx}
                y={36}
                className="tech-tree-era-label-svg"
              >
                {band.label.toUpperCase()}
              </text>
            )
          })}

          {edges.map(({ key, x1, y1, x2, y2, dim }) => (
            <line
              key={key}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`tech-tree-edge-line ${dim ? 'tech-tree-edge--dim' : ''}`}
            />
          ))}

          {TECH_DEFINITIONS.map((def) => {
            const { x, y } = techLayoutCoordinates(def.id)
            const status = computeTechNodeStatus(def, researchedSet, calendarTurn)
            const paint = nodePaint(status)
            const gated = eraOpensOnTurn(def)
            const selectable = Boolean(onSelectTech) && status === 'available'

            let title = `${def.displayName}. ${summarizeBonusLine(def.statBonuses)}`
            if (directiveLine(def).length) title += ` · ${directiveLine(def).join(' · ')}`
            title += `. Cost ${def.knowledgeCost} knowledge`

            const handleKey = selectable
              ? (e: KeyboardEvent<SVGCircleElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectTech?.(def.id)
                  }
                }
              : undefined

            const picked = selectedTechId === def.id
            const rDisc = picked ? 24 : status === 'researched' ? 20 : status === 'available' ? 22 : 19

            return (
              <g
                key={def.id}
                className={`tech-tree-node ${selectable ? 'tech-tree-node--selectable' : ''}`}
                transform={`translate(${x}, ${y})`}
              >
                <title>{`${title}${calendarTurn < gated ? `. Opens century ${gated}` : ''}`}</title>

                <circle
                  r={rDisc}
                  fill={paint.fill}
                  stroke={paint.rim}
                  strokeWidth={picked ? 3.2 : 2}
                  className={`tech-tree-node-disc ${picked ? 'tech-tree-disc--pulse' : ''}`}
                  style={{ cursor: selectable ? 'pointer' : 'default' }}
                  tabIndex={selectable ? 0 : undefined}
                  onClick={() => selectable && onSelectTech?.(def.id)}
                  onKeyDown={handleKey}
                />
                <text
                  textAnchor="middle"
                  dy={6}
                  fill={paint.glyph}
                  fontSize={10}
                  style={{ pointerEvents: 'none', userSelect: 'none', fontFamily: "'Cinzel', serif", fontWeight: 700 }}
                >
                  {def.displayName.slice(0, 2)}
                </text>

                <text
                  y={38}
                  className="tech-tree-node-label-svg"
                  textAnchor="middle"
                  style={{
                    pointerEvents: 'none',
                    userSelect: 'none',
                    fontFamily: "'Cinzel', serif",
                    fontWeight: 600,
                    fontSize: 8,
                  }}
                  fill="#e8dcb8"
                >
                  {def.displayName.toUpperCase()}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
