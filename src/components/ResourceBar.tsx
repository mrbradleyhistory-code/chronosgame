import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { parseCivResources } from '../lib/statsCalc'
import type { CivResources } from '../types/resources'

function FoodIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" aria-hidden="true">
      <line x1="8" y1="14" x2="8" y2="5" />
      <path d="M8 5 L5 2" /><path d="M8 5 L11 2" />
      <path d="M8 8 L5.5 5.5" /><path d="M8 8 L10.5 5.5" />
    </svg>
  )
}

function TimberIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="8,2 14,10 2,10" />
      <rect x="6.5" y="10" width="3" height="4" rx="0.5" fill="currentColor" />
    </svg>
  )
}

function GoldIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
         aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="3.2" />
    </svg>
  )
}

function StoneIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="9"  width="12" height="5" rx="1" />
      <rect x="4" y="4"  width="8"  height="4.5" rx="1" />
    </svg>
  )
}

interface TradeItemProps {
  Icon:  () => ReactElement
  label: string
  value: number
}

function TradeItem({ Icon, label, value }: TradeItemProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1" title={label}>
      <span className="w-3.5 h-3.5 text-slate-400 shrink-0"><Icon /></span>
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-100 ml-0.5">{value.toLocaleString()}</span>
    </div>
  )
}

interface LuxBadgeProps {
  name: string
  has:  boolean
}

function LuxBadge({ name, has }: LuxBadgeProps) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${
        has
          ? 'border-amber-600/60 bg-amber-950/40 text-amber-200'
          : 'border-slate-700 text-slate-600'
      }`}
      title={name}
    >
      {name}
    </span>
  )
}

type TradeKey = keyof Pick<CivResources, 'food' | 'timber' | 'gold' | 'stone'>
type LuxKey   = keyof Pick<CivResources, 'spices' | 'silk' | 'marble' | 'horses' | 'iron'>

const TRADE_ITEMS: { key: TradeKey; label: string; Icon: () => ReactElement }[] = [
  { key: 'food',   label: 'Food',   Icon: FoodIcon   },
  { key: 'timber', label: 'Timber', Icon: TimberIcon },
  { key: 'gold',   label: 'Gold',   Icon: GoldIcon   },
  { key: 'stone',  label: 'Stone',  Icon: StoneIcon  },
]

const LUX_ITEMS: { key: LuxKey; name: string }[] = [
  { key: 'spices', name: 'Spices' },
  { key: 'silk',   name: 'Silk'   },
  { key: 'marble', name: 'Marble' },
  { key: 'horses', name: 'Horses' },
  { key: 'iron',   name: 'Iron'   },
]

interface ResourceBarProps {
  resources: Record<string, unknown>
}

export function ResourceBar({ resources }: ResourceBarProps) {
  const res = useMemo(() => parseCivResources(resources), [resources])

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 border-b border-slate-700 bg-slate-800/60 shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Resources</span>
      {TRADE_ITEMS.map(({ key, label, Icon }) => (
        <TradeItem key={key} Icon={Icon} label={label} value={res[key]} />
      ))}
      <span className="hidden sm:block w-px h-5 bg-slate-700 mx-1" aria-hidden />
      <div className="flex flex-wrap items-center gap-1.5">
        {LUX_ITEMS.map(({ key, name }) => (
          <LuxBadge key={key} name={name} has={res[key]} />
        ))}
      </div>
    </div>
  )
}
