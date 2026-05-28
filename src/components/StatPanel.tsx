import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { parseCivResources } from '../lib/statsCalc'
import type { CivResources } from '../types/resources'

function PopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6"  r="3.2" />
      <circle cx="5"  cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M3 22c0-4.4 3.8-6 9-6s9 1.6 9 6" />
    </svg>
  )
}

function MilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="3" x2="12" y2="17" />
      <line x1="8" y1="9.5" x2="16" y2="9.5" />
      <circle cx="12" cy="19.5" r="1.8" fill="currentColor" />
    </svg>
  )
}

function WealthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2h6l1.5 5Q19 10 17 13l-1 8H8l-1-8Q5 10 7.5 7Z" />
      <path d="M9 4Q6 4 6 7Q6 10 9 10" />
      <path d="M15 4Q18 4 18 7Q18 10 15 10" />
    </svg>
  )
}

function KnowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="8.5" y1="8"  x2="15.5" y2="8"  />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
      <line x1="8.5" y1="16" x2="12.5" y2="16" />
    </svg>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

interface StatConfig {
  key:   keyof Pick<CivResources, 'population' | 'military' | 'wealth' | 'knowledge'>
  label: string
  Icon:  () => ReactElement
  accent: string
}

const STATS: StatConfig[] = [
  { key: 'population', label: 'Population', Icon: PopIcon,    accent: 'text-sky-300' },
  { key: 'military',   label: 'Military',   Icon: MilIcon,    accent: 'text-rose-300' },
  { key: 'wealth',     label: 'Wealth',     Icon: WealthIcon, accent: 'text-amber-300' },
  { key: 'knowledge',  label: 'Knowledge',  Icon: KnowIcon,   accent: 'text-violet-300' },
]

interface StatPanelProps {
  resources: Record<string, unknown>
}

export function StatPanel({ resources }: StatPanelProps) {
  const res = useMemo(() => parseCivResources(resources), [resources])

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/90 overflow-hidden">
      <header className="px-3 py-2 border-b border-slate-700">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Civilization stats</h2>
      </header>
      <div className="grid grid-cols-2">
        {STATS.map(({ key, label, Icon, accent }, idx) => (
          <div
            key={key}
            className={`flex flex-col items-center gap-1 px-2 py-3 ${
              idx % 2 === 0 ? 'border-r border-slate-700/80' : ''
            } ${idx < 2 ? 'border-b border-slate-700/80' : ''}`}
          >
            <span className={`w-6 h-6 ${accent} opacity-90`}>
              <Icon />
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
            <span className={`text-lg font-semibold tabular-nums leading-none ${accent}`}>
              {fmt(res[key])}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
