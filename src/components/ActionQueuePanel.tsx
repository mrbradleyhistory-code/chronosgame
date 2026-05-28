import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HexCell } from '../lib/hexUtils'
import { useStudent } from '../contexts/StudentContext'
import type { Civilization } from '../contexts/StudentContext'
import type { QueueActionType, QueueReviewStatus } from '../types/actions'
import { parseGameSettings } from '../types/resources'
import {
  queuedActionCost,
  queuedActionsSpendAp,
  maxActionPointsForCiv,
} from '../lib/turnEngine'
import { BUILDING_DEFS, ADOPTABLE_POLICY_IDS } from '../lib/gameContent'
import {
  TECH_DEFINITIONS,
  civilizationHasTechAction,
  civilizationMayBuild,
  eraOpensOnTurn,
  prerequisitesMet,
} from '../lib/techTree'
import { parseCivResources } from '../lib/statsCalc'
import { TechTreePanel } from './TechTreePanel'

interface Peer {
  id: string
  group_name: string
}

interface ActionQueuePanelProps {
  civilization: Civilization
  peers: Peer[]
  currentTurn: number
  pinnedHex: HexCell | null
  /** Valid adjacent hexes for EXPAND when queued. */
  expandTargets?: HexCell[]
  onExpandModeChange?: (active: boolean) => void
  queueFromServer: Array<{
    slot_index: number
    action_type: string
    review_status: string
    payload?: Record<string, unknown>
  }>
  settingsUnknown: unknown
  onHydrate: () => Promise<void>
}

type DraftSlot = {
  action_type: QueueActionType | ''
  payload: Record<string, unknown>
}

const EMPTY_DRAFT: DraftSlot[] = [
  { action_type: '', payload: {} },
  { action_type: '', payload: {} },
  { action_type: '', payload: {} },
]

const fieldSelect =
  'w-full rounded-md border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40 disabled:opacity-50'
const fieldInput =
  'rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40 w-20'
const fieldLabel = 'block text-xs font-medium text-slate-400 mb-1'

function reviewStatusLabel(status: string): string {
  switch (status as QueueReviewStatus) {
    case 'submitted':
      return 'Waiting for teacher'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'modified':
      return 'Modified by teacher'
    case 'draft':
      return 'Draft'
    default:
      return status
  }
}

function reviewStatusClasses(status: string): string {
  switch (status as QueueReviewStatus) {
    case 'submitted':
      return 'bg-amber-500/15 text-amber-100 border-amber-500/40'
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-100 border-emerald-500/35'
    case 'rejected':
      return 'bg-rose-500/15 text-rose-100 border-rose-500/35'
    case 'modified':
      return 'bg-sky-500/15 text-sky-100 border-sky-500/35'
    default:
      return 'bg-slate-700 text-slate-300 border-slate-600'
  }
}

export function ActionQueuePanel({
  civilization,
  peers,
  currentTurn,
  pinnedHex,
  expandTargets = [],
  onExpandModeChange,
  queueFromServer,
  settingsUnknown,
  onHydrate,
}: ActionQueuePanelProps) {
  const { submitTurnDraft } = useStudent()

  const [drafts, setDrafts]     = useState<DraftSlot[]>(() => structuredClone(EMPTY_DRAFT))
  const [busy, setBusy]         = useState(false)
  const [notice, setNotice]     = useState('')
  const [error, setError]       = useState<string | null>(null)

  const settings = parseGameSettings(settingsUnknown)
  const maxAp = useMemo(
    () => maxActionPointsForCiv(settings, civilization.techs ?? [], civilization.policies ?? []),
    [civilization.policies, civilization.techs, settings],
  )

  const researchedTechSet = useMemo(() => new Set(civilization.techs ?? []), [civilization.techs])
  const knowledgeVault = useMemo(
    () => parseCivResources(civilization.resources as Record<string, unknown>).knowledge,
    [civilization.resources],
  )
  const exploreUnlocked = useMemo(
    () => civilizationHasTechAction(civilization.techs ?? [], 'EXPLORE'),
    [civilization.techs],
  )

  const attainableResearch = useMemo(
    () =>
      TECH_DEFINITIONS.filter(
        (def) =>
          !researchedTechSet.has(def.id) &&
          prerequisitesMet(researchedTechSet, def) &&
          currentTurn >= eraOpensOnTurn(def),
      ),
    [currentTurn, researchedTechSet],
  )

  const draftedResearchTechId = useMemo(() => {
    const row = drafts.find((d) => d.action_type === 'RESEARCH' && typeof d.payload.techId === 'string')
    return row ? (row.payload.techId as string) : undefined
  }, [drafts])

  const applyResearchPick = useCallback((techId: string, slotHint?: number) => {
    setDrafts((prev) => {
      const next = prev.map((row) => ({ ...row, payload: { ...row.payload } }))
      let applied = false
      if (typeof slotHint === 'number' && next[slotHint]?.action_type === '') {
        next[slotHint] = { action_type: 'RESEARCH', payload: { techId } }
        applied = true
      } else {
        const researchIdx = next.findIndex((d) => d.action_type === 'RESEARCH')
        if (researchIdx >= 0) {
          next[researchIdx] = { action_type: 'RESEARCH', payload: { techId } }
          applied = true
        } else {
          const blankIdx = next.findIndex((d) => d.action_type === '')
          if (blankIdx >= 0) {
            next[blankIdx] = { action_type: 'RESEARCH', payload: { techId } }
            applied = true
          }
        }
      }
      return applied ? next : prev
    })
  }, [])

  const spend = useMemo(() => {
    const rows = drafts
      .filter((d) => d.action_type !== '')
      .map((d) => ({
        action_type: d.action_type as QueueActionType,
        payload: d.payload,
      }))
      .filter((d) => queuedActionCost(d.action_type, d.payload) != null)

    return queuedActionsSpendAp(rows)
  }, [drafts])

  const stagedRows = drafts
    .map((draft, idx) => ({ draft, idx }))
    .filter(({ draft }) => draft.action_type !== '')

  const waitingOnTeacher =
    queueFromServer.length > 0 && queueFromServer.every((slot) => slot.review_status === 'submitted')

  const apPct = maxAp > 0 ? Math.min(100, (spend / maxAp) * 100) : 0
  const apOver = spend > maxAp

  const updateDraft = useCallback((index: number, patch: Partial<DraftSlot>) => {
    setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }, [])

  const expandDraftActive = useMemo(
    () => drafts.some((d) => d.action_type === 'EXPAND'),
    [drafts],
  )

  useEffect(() => {
    onExpandModeChange?.(expandDraftActive)
  }, [expandDraftActive, onExpandModeChange])

  const needsMapTarget = useMemo(
    () =>
      stagedRows.some((r) =>
        ['EXPLORE', 'ATTACK', 'BUILD'].includes(String(r.draft.action_type)),
      ) || expandDraftActive,
    [stagedRows, expandDraftActive],
  )

  async function submit() {
    setError(null)
    setNotice('')

    if (expandDraftActive) {
      if (!pinnedHex) {
        setError('Click a highlighted green hex next to your territory to choose where to expand.')
        return
      }
      const validExpand = expandTargets.some((t) => t.q === pinnedHex.q && t.r === pinnedHex.r)
      if (!validExpand) {
        setError('That hex is not a valid expand target — pick an adjacent unclaimed tile (green outline).')
        return
      }
    }

    const otherMapActions = stagedRows.filter(
      (r) => ['EXPLORE', 'ATTACK', 'BUILD'].includes(String(r.draft.action_type)),
    )
    if (otherMapActions.length > 0 && !pinnedHex) {
      setError('Choose a hex on the map first (click inside your visible territory).')
      return
    }

    const prepared = drafts
      .map((draft, idx) => ({ draft, idx }))
      .filter(({ draft }) => draft.action_type !== '')
      .map(({ draft, idx }) => ({
        slot_index: idx,
        action_type: draft.action_type,
        payload: enrichPayload(draft, pinnedHex),
      }))

    if (!prepared.length) {
      setError('Add at least one action before submitting.')
      return
    }

    if (spend > maxAp) {
      setError(`These actions need ${spend} AP but you only have ${maxAp} this turn.`)
      return
    }

    setBusy(true)
    const rpcErr = await submitTurnDraft(prepared)
    setBusy(false)

    if (rpcErr) {
      setError(rpcErr)
      return
    }

    setNotice('Submitted — your teacher will approve each action, then advance the turn for it to take effect.')
    setDrafts(structuredClone(EMPTY_DRAFT))
    await onHydrate()
  }

  function enrichPayload(slot: DraftSlot, targetHex: HexCell | null): Record<string, unknown> {
    const base = { ...slot.payload }
    if (['EXPAND', 'EXPLORE', 'ATTACK', 'BUILD'].includes(String(slot.action_type)) && targetHex) {
      base.q = targetHex.q
      base.r = targetHex.r
    }
    if (slot.action_type === 'TRADE' && typeof base.toCivId !== 'string') {
      delete base.toCivId
    }
    return base
  }

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/90 overflow-hidden">
      <header className="px-3 py-3 border-b border-slate-700 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Turn actions</h2>
            <p className="text-sm text-slate-300 mt-1 leading-snug font-normal tracking-normal">
              Century {currentTurn}: up to 3 actions, {maxAp} AP total
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-sm font-semibold tabular-nums ${apOver ? 'text-rose-300' : 'text-slate-100'}`}>
              {spend} / {maxAp} AP
            </p>
            <p className="text-[10px] text-slate-500">planned</p>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden" aria-hidden>
          <div
            className={`h-full transition-all duration-200 ${apOver ? 'bg-rose-500' : 'bg-amber-500'}`}
            style={{ width: `${apPct}%` }}
          />
        </div>
      </header>

      <div className="p-3 space-y-3">
        {waitingOnTeacher && (
          <p className="text-xs text-amber-100 bg-amber-950/35 border border-amber-900/50 rounded-lg px-3 py-2 leading-relaxed">
            Your actions are with the teacher for review. You cannot change them until the turn advances or they are sent
            back.
          </p>
        )}

        {expandDraftActive && (
          <p className="text-xs text-emerald-100 bg-emerald-950/35 border border-emerald-800/50 rounded-lg px-3 py-2 leading-relaxed">
            Expand: click a green-outlined hex adjacent to your territory. You can pick tiles in the fog at your border.
            Territory updates after your teacher approves and advances the turn.
          </p>
        )}

        {pinnedHex && needsMapTarget && (
          <p className="text-xs text-slate-300 bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2">
            Map target: hex ({pinnedHex.q}, {pinnedHex.r})
          </p>
        )}

        {[0, 1, 2].map((slotIdx) => (
          <div key={slotIdx} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-2.5">
            <p className="text-xs font-semibold text-slate-300">Action slot {slotIdx + 1}</p>
            <select
              value={drafts[slotIdx]?.action_type ?? ''}
              disabled={waitingOnTeacher || busy}
              onChange={(e) =>
                updateDraft(slotIdx, {
                  action_type: (e.target.value || '') as QueueActionType | '',
                  payload: {},
                })
              }
              className={fieldSelect}
            >
              <option value="">Choose an action…</option>
              <option value="EXPAND">Expand territory (1 AP)</option>
              {exploreUnlocked && <option value="EXPLORE">Explore coast (1 AP)</option>}
              <option value="ATTACK">Attack hex (2 AP)</option>
              <option value="TRADE">Trade with another civ (1 AP)</option>
              <option value="RESEARCH">Research technology (1 AP)</option>
              <option value="BUILD">Build structure (1–2 AP)</option>
              <option value="ENACT_POLICY">Enact policy (1 AP)</option>
            </select>

            {drafts[slotIdx]?.action_type === 'TRADE' && (
              <div className="space-y-2 text-sm">
                <div>
                  <label className={fieldLabel}>Trade partner</label>
                  <select
                    className={fieldSelect}
                    value={String(drafts[slotIdx].payload.toCivId ?? '')}
                    onChange={(e) =>
                      updateDraft(slotIdx, { payload: { ...drafts[slotIdx].payload, toCivId: e.target.value } })
                    }
                  >
                    <option value="">Select civilization…</option>
                    {peers
                      .filter((p) => p.id !== civilization.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.group_name}
                        </option>
                      ))}
                  </select>
                </div>
                {(['food', 'timber', 'gold', 'stone'] as const).map((k) => (
                  <label key={k} className="flex items-center justify-between gap-3 text-xs text-slate-400 capitalize">
                    {k}
                    <input
                      type="number"
                      min={0}
                      value={Number(drafts[slotIdx].payload[k] ?? 0)}
                      onChange={(e) =>
                        updateDraft(slotIdx, {
                          payload: { ...drafts[slotIdx].payload, [k]: Number(e.target.value) },
                        })
                      }
                      className={fieldInput}
                    />
                  </label>
                ))}
              </div>
            )}

            {drafts[slotIdx]?.action_type === 'RESEARCH' && (
              <div>
                <label className={fieldLabel}>Technology</label>
                <select
                  className={fieldSelect}
                  value={String(drafts[slotIdx].payload.techId ?? '')}
                  onChange={(e) => updateDraft(slotIdx, { payload: { techId: e.target.value } })}
                >
                  <option value="">Select technology…</option>
                  {attainableResearch.map((def) => (
                    <option key={def.id} value={def.id}>
                      {def.displayName} ({def.knowledgeCost} knowledge)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {drafts[slotIdx]?.action_type === 'BUILD' && (
              <div>
                <label className={fieldLabel}>Building</label>
                <select
                  className={fieldSelect}
                  value={String(drafts[slotIdx].payload.buildingId ?? '')}
                  onChange={(e) =>
                    updateDraft(slotIdx, { payload: { ...drafts[slotIdx].payload, buildingId: e.target.value } })
                  }
                >
                  <option value="">Select building…</option>
                  {Object.values(BUILDING_DEFS)
                    .filter((b) => civilizationMayBuild(civilization.techs ?? [], b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.displayName} ({b.apCost} AP · {b.goldCost ?? 0} gold / {b.stoneCost ?? 0} stone)
                      </option>
                    ))}
                </select>
              </div>
            )}

            {drafts[slotIdx]?.action_type === 'ENACT_POLICY' && (
              <div>
                <label className={fieldLabel}>Policy</label>
                <select
                  className={fieldSelect}
                  value={String(drafts[slotIdx].payload.policyId ?? '')}
                  onChange={(e) => updateDraft(slotIdx, { payload: { policyId: e.target.value } })}
                >
                  <option value="">Select policy…</option>
                  {ADOPTABLE_POLICY_IDS.filter((pid) => !(civilization.policies ?? []).includes(pid)).map((pid) => (
                    <option key={pid} value={pid}>
                      {pid}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}

        <TechTreePanel
          embedded
          researchedIds={Array.from(researchedTechSet)}
          calendarTurn={currentTurn}
          knowledge={knowledgeVault}
          selectedTechId={draftedResearchTechId}
          onSelectTech={(tid) => applyResearchPick(tid)}
        />

        {queueFromServer.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 space-y-2">
            <p className="text-xs font-semibold text-slate-300">Submitted this turn</p>
            <ul className="space-y-1.5">
              {queueFromServer.map((row, i) => (
                <li
                  key={`${row.slot_index}-${row.action_type}-${i}`}
                  className="flex flex-wrap items-center gap-2 text-xs text-slate-400"
                >
                  <span className="text-slate-300">
                    Slot {row.slot_index + 1}: <span className="font-medium">{row.action_type}</span>
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${reviewStatusClasses(row.review_status)}`}
                  >
                    {reviewStatusLabel(row.review_status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-xs text-rose-100 bg-rose-950/40 border border-rose-900/60 rounded-lg px-3 py-2">{error}</p>
        )}
        {notice && (
          <p className="text-xs text-emerald-100 bg-emerald-950/35 border border-emerald-900/50 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || waitingOnTeacher}
          className="w-full rounded-md bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Submitting…' : waitingOnTeacher ? 'Waiting on teacher' : 'Submit for teacher review'}
        </button>
      </div>
    </section>
  )
}
