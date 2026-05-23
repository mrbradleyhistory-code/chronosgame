import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { parseCivResources } from '../lib/statsCalc'
import type { CivResources } from '../types/resources'

// ─── Icon components ──────────────────────────────────────────────────────────

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
      {/* blade */}
      <line x1="12" y1="3" x2="12" y2="17" />
      {/* crossguard */}
      <line x1="8" y1="9.5" x2="16" y2="9.5" />
      {/* pommel */}
      <circle cx="12" cy="19.5" r="1.8" fill="currentColor" />
    </svg>
  )
}

function WealthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* amphora body */}
      <path d="M9 2h6l1.5 5Q19 10 17 13l-1 8H8l-1-8Q5 10 7.5 7Z" />
      {/* handles */}
      <path d="M9 4Q6 4 6 7Q6 10 9 10" />
      <path d="M15 4Q18 4 18 7Q18 10 15 10" />
    </svg>
  )
}

function KnowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* scroll body */}
      <rect x="5" y="3" width="14" height="18" rx="2" />
      {/* text lines */}
      <line x1="8.5" y1="8"  x2="15.5" y2="8"  />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
      <line x1="8.5" y1="16" x2="12.5" y2="16" />
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

// ─── Stat cell config ────────────────────────────────────────────────────────

interface StatConfig {
  key:   keyof Pick<CivResources, 'population' | 'military' | 'wealth' | 'knowledge'>
  label: string
  Icon:  () => ReactElement
  accent: string   // CSS color for the icon + value
}

const STATS: StatConfig[] = [
  { key: 'population', label: 'People',   Icon: PopIcon,    accent: '#7a4e1e' },
  { key: 'military',   label: 'Armies',   Icon: MilIcon,    accent: '#8b1a1a' },
  { key: 'wealth',     label: 'Treasury', Icon: WealthIcon, accent: '#7a6010' },
  { key: 'knowledge',  label: 'Learning', Icon: KnowIcon,   accent: '#1a4a7a' },
]

// ─── Component ───────────────────────────────────────────────────────────────

interface StatPanelProps {
  resources: Record<string, unknown>
}

export function StatPanel({ resources }: StatPanelProps) {
  const res = useMemo(() => parseCivResources(resources), [resources])

  return (
    <div className="stat-panel">
      {/* Header rod */}
      <div className="scroll-ornament top">
        <span className="ornament-line" />
        <span className="ornament-symbol">⚔</span>
        <span className="stat-panel-heading">Realm Status</span>
        <span className="ornament-symbol">⚔</span>
        <span className="ornament-line" />
      </div>

      {/* 2 × 2 stat grid */}
      <div className="stat-grid">
        {STATS.map(({ key, label, Icon, accent }) => (
          <div key={key} className="stat-cell">
            <span className="stat-icon-wrap" style={{ color: accent }}>
              <Icon />
            </span>
            <span className="stat-label">{label}</span>
            <span className="stat-value" style={{ color: accent }}>
              {fmt(res[key])}
            </span>
          </div>
        ))}
      </div>

      {/* Footer rod */}
      <div className="scroll-ornament bottom">
        <span className="ornament-line" />
        <span className="ornament-symbol">✦</span>
        <span className="ornament-line" />
      </div>
    </div>
  )
}
