import { useCallback, useMemo, useState } from 'react'
import type { HexCell } from '../lib/hexUtils'
import { useStudent } from '../contexts/StudentContext'
import type { Civilization } from '../contexts/StudentContext'
import type { QueueActionType } from '../types/actions'
import { parseGameSettings } from '../types/resources'
import {
  queuedActionCost,
  queuedActionsSpendAp,
  maxActionPointsForCiv,
} from '../lib/turnEngine'
import {
  BUILDING_DEFS,
  ADOPTABLE_POLICY_IDS,
  RESEARCH_COSTS,
  RESEARCH_TECH_ORDER,
} from '../lib/gameContent'

interface Peer {
  id: string
  group_name: string
}

interface ActionQueuePanelProps {
  civilization: Civilization
  peers: Peer[]
  currentTurn: number
  pinnedHex: HexCell | null
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

function IconFeather() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 20l4-14 9 9-14 4z M14 9l5 5" />
    </svg>
  )
}

export function ActionQueuePanel({
  civilization,
  peers,
  currentTurn,
  pinnedHex,
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

  const waitingOnMagistrate =
    queueFromServer.length > 0 && queueFromServer.every((slot) => slot.review_status === 'submitted')

  const updateDraft = useCallback((index: number, patch: Partial<DraftSlot>) => {
    setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }, [])

  async function submit() {
    setError(null)
    setNotice('')
    if (
      pinnedHex === null &&
      stagedRows.some((r) => ['EXPAND', 'ATTACK', 'BUILD'].includes(String(r.draft.action_type)))
    ) {
      setError('Tap the map mosaic to emboss coordinates for frontier decrees.')
      return
    }

    const prepared = drafts
      .map((draft, idx) => ({ draft, idx }))
      .filter(({ draft }) => draft.action_type !== '')
      .map(({ draft, idx }) => ({
        slot_index: idx,
        action_type: draft.action_type,
        payload: enrichPayload(draft),
      }))

    if (!prepared.length) {
      setError('Queue at least one imperial decree.')
      return
    }

    if (spend > maxAp) {
      setError(`These plans thirst for ${spend} action points yet you only marshal ${maxAp}.`)
      return
    }

    setBusy(true)
    const rpcErr = await submitTurnDraft(prepared)
    setBusy(false)

    if (rpcErr) {
      setError(rpcErr)
      return
    }

    setNotice('Treaty scroll sealed — awaiting the classroom magistrate.')
    setDrafts(structuredClone(EMPTY_DRAFT))
    await onHydrate()
  }

  function enrichPayload(slot: DraftSlot): Record<string, unknown> {
    const base = { ...slot.payload }
    if (['EXPAND', 'ATTACK', 'BUILD'].includes(String(slot.action_type)) && pinnedHex) {
      base.q = pinnedHex.q
      base.r = pinnedHex.r
    }
    if (slot.action_type === 'TRADE' && typeof base.toCivId !== 'string') {
      delete base.toCivId
    }
    return base
  }

  return (
    <div className="scroll-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2 border-b border-amber-700/35 pb-2">
        <div>
          <h2 className="scroll-title text-base flex items-center gap-2">
            <IconFeather /> Action Queue
          </h2>
          <p className="scroll-subtitle text-[11px] mt-1">
            Century {currentTurn}: plan ≤3 decrees totaling ≤{maxAp} AP.
          </p>
        </div>
        <div className="text-right parchment-label text-[10px]">
          Spend {spend} / {maxAp} AP
        </div>
      </div>

      {waitingOnMagistrate && (
        <p className="scroll-body text-[11px] leading-snug text-[#5c3312]">
          Courier reports your sealed plans are traversing neighbouring courts — revise only if recalled by the instructor.
        </p>
      )}

      {[0, 1, 2].map((slotIdx) => (
        <div key={slotIdx} className="stat-panel px-3 py-2 space-y-2 rounded-lg bg-[#fcf3db]/60">
          <p className="parchment-label text-[10px]">Decree #{slotIdx + 1}</p>
          <select
            value={drafts[slotIdx]?.action_type ?? ''}
            onChange={(e) =>
              updateDraft(slotIdx, {
                action_type: (e.target.value || '') as QueueActionType | '',
                payload: {},
              })
            }
            className="parchment-input text-xs w-full border border-amber-800/35"
          >
            <option value="">— choose decree —</option>
            <option value="EXPAND">Expand borders (1 AP)</option>
            <option value="ATTACK">Assault neighbouring tile (2 AP)</option>
            <option value="TRADE">Royal caravan gift (1 AP)</option>
            <option value="RESEARCH">Sponsor scholars (1 AP)</option>
            <option value="BUILD">Raise a structure (1–2 AP)</option>
            <option value="ENACT_POLICY">Proclaim civic doctrine (1 AP)</option>
          </select>

          {drafts[slotIdx]?.action_type === 'TRADE' && (
            <div className="space-y-1 text-xs parchment-label">
              <label className="block">Receiving court</label>
              <select
                className="parchment-input text-xs w-full"
                value={String(drafts[slotIdx].payload.toCivId ?? '')}
                onChange={(e) =>
                  updateDraft(slotIdx, { payload: { ...drafts[slotIdx].payload, toCivId: e.target.value } })
                }
              >
                <option value="">— ally —</option>
                {peers
                  .filter((p) => p.id !== civilization.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.group_name}
                    </option>
                  ))}
              </select>
              {(['food', 'timber', 'gold', 'stone'] as const).map((k) => (
                <label key={k} className="flex justify-between gap-2 items-center parchment-label capitalize">
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
                    className="parchment-input w-24 text-xs"
                  />
                </label>
              ))}
            </div>
          )}

          {drafts[slotIdx]?.action_type === 'RESEARCH' && (
            <div className="text-xs parchment-label space-y-1">
              <label className="block">Scholarly tract</label>
              <select
                className="parchment-input w-full text-xs"
                value={String(drafts[slotIdx].payload.techId ?? '')}
                onChange={(e) => updateDraft(slotIdx, { payload: { techId: e.target.value } })}
              >
                <option value="">— codex entry —</option>
                {RESEARCH_TECH_ORDER.filter((tid) => !(civilization.techs ?? []).includes(tid)).map((tid) => (
                  <option key={tid} value={tid}>
                    {tid.replace(/_/g, ' ')} ({RESEARCH_COSTS[tid]} know.)
                  </option>
                ))}
              </select>
            </div>
          )}

          {drafts[slotIdx]?.action_type === 'BUILD' && (
            <div className="text-xs parchment-label space-y-1">
              <label className="block">Blueprint</label>
              <select
                className="parchment-input w-full text-xs"
                value={String(drafts[slotIdx].payload.buildingId ?? '')}
                onChange={(e) =>
                  updateDraft(slotIdx, { payload: { ...drafts[slotIdx].payload, buildingId: e.target.value } })
                }
              >
                <option value="">— structure —</option>
                {Object.values(BUILDING_DEFS).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName} ({b.apCost} AP · {b.goldCost ?? 0}/{b.stoneCost ?? 0})
                  </option>
                ))}
              </select>
            </div>
          )}

          {drafts[slotIdx]?.action_type === 'ENACT_POLICY' && (
            <div className="text-xs parchment-label space-y-1">
              <label className="block">Doctrine</label>
              <select
                className="parchment-input w-full text-xs"
                value={String(drafts[slotIdx].payload.policyId ?? '')}
                onChange={(e) => updateDraft(slotIdx, { payload: { policyId: e.target.value } })}
              >
                <option value="">— policy —</option>
                {ADOPTABLE_POLICY_IDS.filter((pid) => !(civilization.policies ?? []).includes(pid)).map((pid) => (
                  <option key={pid} value={pid}>
                    {pid}
                  </option>
                ))}
              </select>
            </div>
          )}

          {['EXPAND', 'ATTACK', 'BUILD'].includes(String(drafts[slotIdx]?.action_type)) && pinnedHex && (
            <p className="stat-value text-[11px] text-[#7a4e1e]">
              Mosaic focus → ({pinnedHex.q}, {pinnedHex.r})
            </p>
          )}
        </div>
      ))}

      {queueFromServer.length > 0 && (
        <div className="text-[11px] space-y-1 parchment-label scroll-body">
          <p className="font-semibold">Latest sealed scrolls:</p>
          <ul className="list-disc ml-5 space-y-1">
            {queueFromServer.map((row, i) => (
              <li key={`${row.slot_index}-${row.action_type}-${i}`}>
                Slot {row.slot_index + 1}: {row.action_type}
                {' — '}
                <span className="opacity-75">{row.review_status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="parchment-error">{error}</p>}
      {notice && <p className="text-[11px] text-emerald-800">{notice}</p>}

      <button type="button" onClick={() => void submit()} disabled={busy} className="parchment-btn w-full text-xs py-2">
        {busy ? 'Sealing parchment…' : 'Submit decree queue'}
      </button>
    </div>
  )
}
