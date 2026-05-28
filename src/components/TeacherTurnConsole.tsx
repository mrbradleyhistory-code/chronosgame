import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { advanceGameTurnTeacher } from '../lib/teacherAdvanceTurn'
import { coerceGameTurn } from '../lib/coerceTurn'
import { fetchTeacherTurnSlotsForGameTurn } from '../lib/teacherTurnSlotsRpc'
import { useAuth } from '../contexts/AuthContext'
import type { TurnActionSlotRow } from '../types/actions'

interface TeacherTurnConsoleProps {
  gameId: string
}

interface CivBrief {
  id: string
  group_name: string
}

interface QueueRow extends TurnActionSlotRow {
  civilization?: CivBrief | null
}

type TeacherReviewRpcEnvelope = { ok?: boolean; error?: string; status?: string }

function unwrapRpcTopLevel(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    if (raw.length === 1) return raw[0]
    return raw
  }
  return raw
}

/** PostgREST / drivers sometimes wrap jsonb RPC results as strings or nested JSON. */
function parseJsonGreedy(raw: unknown): unknown {
  let v: unknown = unwrapRpcTopLevel(raw)
  for (let i = 0; i < 6; i += 1) {
    if (typeof v !== 'string') break
    const s = v.trim()
    if (!s.startsWith('{') && !s.startsWith('[')) break
    try {
      v = JSON.parse(s) as unknown
    } catch {
      break
    }
  }
  return v
}

function coerceTeacherReviewRpcResult(raw: unknown): TeacherReviewRpcEnvelope | null {
  const parsed = parseJsonGreedy(raw)
  if (parsed === null || parsed === undefined) return null
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>
    const okRaw = o.ok
    const ok =
      okRaw === true || okRaw === 'true'
        ? true
        : okRaw === false || okRaw === 'false'
          ? false
          : undefined
    return {
      ...(ok !== undefined ? { ok } : {}),
      error: typeof o.error === 'string' ? o.error : undefined,
      status: typeof o.status === 'string' ? o.status : undefined,
    }
  }
  return null
}

function stashTribunalDebug(payload: Record<string, unknown>) {
  try {
    sessionStorage.setItem('chronos_debug_tribunal', JSON.stringify({ ...payload, ts: Date.now() }))
  } catch {
    /* ignore quota / privacy mode */
  }
}

function flattenSupabaseError(err: PostgrestError): string {
  return [err.message, err.details, err.hint].filter((x) => typeof x === 'string' && x.trim().length > 0).join(' — ')
}

function policyDisplayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function actionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    EXPAND: 'Expand',
    EXPLORE: 'Explore',
    ATTACK: 'Attack',
    TRADE: 'Trade',
    RESEARCH: 'Research',
    BUILD: 'Build',
    ENACT_POLICY: 'Policy',
  }
  return labels[type] ?? type.replace(/_/g, ' ')
}

function formatDecreeSummary(row: QueueRow, civNames: Record<string, string>): string {
  const p = row.payload as Record<string, unknown>
  switch (row.action_type) {
    case 'TRADE': {
      const cid = typeof p.toCivId === 'string' ? p.toCivId : null
      const toName = cid ? (civNames[cid] ?? `Civ ${cid.slice(0, 8)}…`) : 'another court'
      const bits: string[] = []
      for (const key of ['food', 'timber', 'gold', 'stone'] as const) {
        const n = p[key]
        if (typeof n === 'number' && n !== 0) bits.push(`${n} ${key}`)
      }
      return bits.length > 0 ? `Send ${bits.join(', ')} to ${toName}.` : `Trade embassy to ${toName}.`
    }
    case 'EXPAND':
    case 'EXPLORE':
    case 'ATTACK':
    case 'BUILD':
      if (p.q != null && p.r != null) return `Target hex (${String(p.q)}, ${String(p.r)}) on the world map.`
      return 'Coordinates inscribed on the imperial map.'
    case 'RESEARCH':
      return typeof p.techId === 'string' ? `Sponsor scholars toward ${p.techId}.` : 'Scholarly commission.'
    case 'ENACT_POLICY':
      return typeof p.policyId === 'string'
        ? `Proclaim ${policyDisplayName(p.policyId)} as civic doctrine.`
        : 'Doctrine of state.'
    default:
      return String(row.action_type)
  }
}

function reviewStatusClass(status: QueueRow['review_status']): string {
  switch (status) {
    case 'submitted':
      return 'tribunal-status tribunal-status--submitted'
    case 'approved':
      return 'tribunal-status tribunal-status--approved'
    case 'rejected':
      return 'tribunal-status tribunal-status--rejected'
    case 'modified':
      return 'tribunal-status tribunal-status--modified'
    default:
      return 'tribunal-status tribunal-status--default'
  }
}

function reviewStatusLabel(status: QueueRow['review_status']): string {
  switch (status) {
    case 'submitted':
      return 'Awaiting seal'
    case 'approved':
      return 'Granted'
    case 'rejected':
      return 'Denied'
    case 'modified':
      return 'Amended'
    default:
      return status
  }
}

export function TeacherTurnConsole({ gameId }: TeacherTurnConsoleProps) {
  const { user } = useAuth()
  const [slots, setSlots]                       = useState<QueueRow[]>([])
  const [turnNumber, setTurnNumber]             = useState<number | null>(null)
  const [loading, setLoading]                   = useState(false)
  const [busyId, setBusyId]                     = useState<string | null>(null)
  const [advancing, setAdvancing]               = useState(false)
  const [message, setMessage]                   = useState<string | null>(null)
  const [loadBanner, setLoadBanner]            = useState<string | null>(null)
  const [civNames, setCivNames]                 = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!gameId) return
    setLoading(true)
    // Do not clear `message` here — setReview/handleAdvance set errors then call load(),
    // and clearing at the start wiped tribunal feedback before paint.

    const { data: game, error: gErr } = await supabase.from('games').select('current_turn, status').eq('id', gameId).single()
    const gameQueryErrText = gErr ? flattenSupabaseError(gErr) : null
    if (gErr || !game) {
      setLoading(false)
      setMessage(gErr?.message ?? 'Unable to read game calendar.')
      return
    }
    const t = coerceGameTurn(game.current_turn)
    setTurnNumber(t)

    const [{ error: slotRpcErr, rows: rpcSlotRows }, { data: civRows, error: civErr }] = await Promise.all([
      fetchTeacherTurnSlotsForGameTurn(gameId, t),
      supabase.from('civilizations').select('id, group_name').eq('game_id', gameId),
    ])

    const slotQueryErrText = slotRpcErr
    const civQueryErrText = civErr ? flattenSupabaseError(civErr) : null

    setLoading(false)

    if (slotRpcErr) {
      const line = slotRpcErr
      setLoadBanner(
        `Could not load decree scrolls: ${line}. If this mentions a missing function, run the latest supabase-turn-engine.sql in the Supabase SQL editor.`,
      )
      setSlots([])
      // #region agent log
      {
        const dbgLoad = {
          sessionId: 'd8d7f0',
          runId: 'post-fix-5',
          hypothesisId: 'C',
          location: 'TeacherTurnConsole.tsx:load',
          message: 'tribunal load slot RPC failed',
          data: {
            gameIdTail: gameId.slice(-8),
            currentTurn: t,
            gameStatus: typeof game.status === 'string' ? game.status : null,
            slotErrFull: slotQueryErrText,
            civErrFull: civQueryErrText,
          },
          timestamp: Date.now(),
        }
        stashTribunalDebug(dbgLoad as unknown as Record<string, unknown>)
        void fetch('http://127.0.0.1:7417/ingest/1c6c16d3-97bb-4ef5-b18a-32d8ab1e4cbd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd8d7f0' },
          body: JSON.stringify(dbgLoad),
        }).catch(() => {})
      }
      // #endregion
      return
    }

    const rawSlots = rpcSlotRows
    const gameStatus = typeof game.status === 'string' ? game.status : ''
    const playableForProbe = ['active', 'paused', 'review']
    let probeDistinctTurns: number[] | null = null
    let probeErrMsg: string | null = null

    if (rawSlots.length === 0 && playableForProbe.includes(gameStatus)) {
      const { data: probeRows, error: probeErr } = await supabase
        .from('turn_action_slots')
        .select('turn_number')
        .eq('game_id', gameId)
        .limit(24)
      if (probeErr) probeErrMsg = probeErr.message
      else {
        probeDistinctTurns = [
          ...new Set(
            (probeRows ?? []).map((row) =>
              coerceGameTurn((row as { turn_number?: unknown }).turn_number),
            ),
          ),
        ].sort((a, b) => a - b)
      }
    }

    let nextLoadBanner: string | null = null
    if (gameStatus === 'lobby') {
      nextLoadBanner =
        'Chronicle dormant — this game is still in lobby. Choose Start Game so students can seal decrees for tribunal.'
    } else if (gameStatus === 'ended') {
      nextLoadBanner =
        'This game has ended. Sealed parchment will not reopen for adjudication.'
    }

    if (probeErrMsg) {
      nextLoadBanner = nextLoadBanner
        ? `${nextLoadBanner} (Turn probe failed: ${probeErrMsg})`
        : `Turn probe failed: ${probeErrMsg}`
    } else if (probeDistinctTurns && probeDistinctTurns.length > 0 && !probeDistinctTurns.includes(t)) {
      nextLoadBanner = `Calendar shows Century ${t}, but clerks filed scrolls under century ${probeDistinctTurns.join(', ')}. Inspect games.current_turn in Supabase — server queue uses the DB integer, not these labels alone.`
    } else if (probeDistinctTurns && probeDistinctTurns.length > 1 && probeDistinctTurns.includes(t)) {
      nextLoadBanner = `Warning: decree rows span multiple century counters (${probeDistinctTurns.join(', ')}); expected only Century ${t} while planning. Consider clearing stale slots in SQL.`
    }

    // #region agent log
    {
      const statuses = rawSlots.reduce<Record<string, number>>((acc, r) => {
        acc[r.review_status] = (acc[r.review_status] ?? 0) + 1
        return acc
      }, {})
      const dbgLoad = {
        sessionId: 'd8d7f0',
        runId: 'post-fix-5',
        hypothesisId: 'B_turn_coerce,C,E,lobby_probe',
        location: 'TeacherTurnConsole.tsx:load',
        message: 'tribunal load',
        data: {
          gameIdTail: gameId.slice(-8),
          gameStatus,
          currentTurnParsed: t,
          rawGameCurrentTurn: game.current_turn,
          rawGameCurrentTurnType: typeof game.current_turn,
          slotCount: rawSlots.length,
          statusBuckets: statuses,
          gameErrFull: gameQueryErrText,
          slotErrFull: slotQueryErrText,
          civErrFull: civQueryErrText,
          slotTurnNumsSample: rawSlots.slice(0, 5).map((r) => r.turn_number),
          probeDistinctTurns,
          probeErrMsg,
        },
        timestamp: Date.now(),
      }
      stashTribunalDebug(dbgLoad as unknown as Record<string, unknown>)
      void fetch('http://127.0.0.1:7417/ingest/1c6c16d3-97bb-4ef5-b18a-32d8ab1e4cbd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd8d7f0' },
        body: JSON.stringify(dbgLoad),
      }).catch(() => {})
    }
    // #endregion

    if (civErr && rawSlots.length > 0) {
      setLoadBanner(
        `Loaded decrees but civilisation names failed to load: ${flattenSupabaseError(civErr)} — scrolls still show below.`,
      )
    } else {
      setLoadBanner(nextLoadBanner)
    }
    const civMap = Object.fromEntries((civRows ?? []).map((c) => [c.id, c]))
    setCivNames(Object.fromEntries((civRows ?? []).map((c) => [c.id, c.group_name])))

    setSlots(
      rawSlots.map((row) => ({
        ...row,
        civilization: civMap[row.civ_id] ?? null,
      })),
    )
  }, [gameId, user?.id])

  useEffect(() => {
    void load()
    const chan = supabase
      .channel(`teacher-queue-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn_action_slots', filter: `game_id=eq.${gameId}` },
        () => {
          void load()
        },
      )
      .subscribe()

    const gameChan = supabase
      .channel(`teacher-game-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(chan)
      void supabase.removeChannel(gameChan)
    }
  }, [gameId, load, user?.id])

  const groupByCiv = useCallback((list: QueueRow[]) => {
    const map = new Map<string, QueueRow[]>()
    list.forEach((row) => {
      const bucket = map.get(row.civ_id)
      if (bucket) bucket.push(row)
      else map.set(row.civ_id, [row])
    })
    map.forEach((arr) => arr.sort((a, b) => a.slot_index - b.slot_index))
    return map
  }, [])

  /** Teacher cares about submitted first; rulings hide from primary list so approve feels final. */
  const awaitingSlots = useMemo(() => slots.filter((s) => s.review_status === 'submitted'), [slots])
  const resolvedSlots = useMemo(
    () => slots.filter((s) => s.review_status === 'approved' || s.review_status === 'rejected' || s.review_status === 'modified'),
    [slots],
  )
  const draftOnly =
    slots.length > 0 && awaitingSlots.length === 0 && resolvedSlots.length === 0
  const groupedAwaiting = useMemo(() => groupByCiv(awaitingSlots), [awaitingSlots, groupByCiv])
  const groupedResolved = useMemo(() => groupByCiv(resolvedSlots), [resolvedSlots, groupByCiv])

  async function setReview(rowId: string, status: QueueRow['review_status'], reviewedPayload?: Record<string, unknown>) {
    setBusyId(rowId)
    setMessage(null)

    // Security-definer RPC — avoids RLS silent 0-row updates on turn_action_slots (see supabase-teacher-review.sql).
    const rpcArgs: {
      p_slot_id: string
      p_status: QueueRow['review_status']
      p_reviewed_payload?: Record<string, unknown>
    } = { p_slot_id: rowId, p_status: status }
    if (reviewedPayload !== undefined) rpcArgs.p_reviewed_payload = reviewedPayload

    const { data: rpcRaw, error: rpcErr } = await supabase.rpc('teacher_review_slot', rpcArgs)

    setBusyId(null)

    const rpcEnvelope = coerceTeacherReviewRpcResult(rpcRaw)
    const rpcOkResolved = rpcEnvelope?.ok === true

    // #region agent log
    const dbgRpc = {
      sessionId: 'd8d7f0',
      runId: 'post-fix-5',
      hypothesisId: 'A',
      location: 'TeacherTurnConsole.tsx:setReview',
      message: 'tribunal teacher_review_slot RPC',
      data: {
        rowIdTail: rowId.slice(-8),
        attemptedStatus: status,
        rpcTransportError: rpcErr?.message ?? null,
        rpcRawType: rpcRaw === null ? 'null' : typeof rpcRaw,
        rpcOk: rpcEnvelope?.ok ?? null,
        rpcOkResolved,
        rpcErrorCode: rpcEnvelope?.error ?? null,
        rpcStatus: rpcEnvelope?.status ?? null,
      },
      timestamp: Date.now(),
    }
    stashTribunalDebug(dbgRpc as unknown as Record<string, unknown>)
    void fetch('http://127.0.0.1:7417/ingest/1c6c16d3-97bb-4ef5-b18a-32d8ab1e4cbd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd8d7f0' },
      body: JSON.stringify(dbgRpc),
    }).catch(() => {})
    // #endregion

    if (rpcErr) setMessage(rpcErr.message)
    else if (!rpcOkResolved) {
      const code = rpcEnvelope?.error
      let msg: string
      if (code === 'unauthorized') {
        msg = 'You are not allowed to judge this decree. Sign in as the teacher who owns this game.'
      } else if (code === 'slot_not_found') {
        msg = 'That decree was not found. Click Refresh and try again.'
      } else if (code === 'invalid_status') {
        msg = 'Invalid ruling status.'
      } else if (code === 'update_failed') {
        msg =
          'The database did not apply this ruling. In Supabase, re-run teacher_review_slot from supabase-turn-engine.sql, then refresh this page.'
      } else if (code != null) {
        msg = `Could not seal ruling (${code}). Deploy the latest supabase-turn-engine.sql if this persists.`
      } else if (rpcRaw !== null && rpcRaw !== undefined && typeof rpcRaw === 'object') {
        msg = `Unexpected tribunal response (${JSON.stringify(rpcRaw).slice(0, 200)}…). Check chronos_debug_tribunal in session storage.`
      } else {
        msg =
          `Unexpected tribunal response (${String(typeof rpcRaw)}). Deploy teacher_review_slot or check your network.`
      }
      setMessage(msg)
    } else {
      setMessage(null)
    }
    await load()
  }

  async function handleAdvance() {
    setAdvancing(true)
    setMessage(null)

    const res = await advanceGameTurnTeacher(gameId)
    setAdvancing(false)

    // #region agent log
    const dbgAdv = {
      sessionId: 'd8d7f0',
      runId: 'post-fix-5',
      hypothesisId: 'D',
      location: 'TeacherTurnConsole.tsx:handleAdvance',
      message: 'advanceGameTurnTeacher result',
      data: {
        ok: !('detail' in res),
        detailOrMessage: 'detail' in res ? res.detail : res.message,
      },
      timestamp: Date.now(),
    }
    stashTribunalDebug(dbgAdv as unknown as Record<string, unknown>)
    void fetch('http://127.0.0.1:7417/ingest/1c6c16d3-97bb-4ef5-b18a-32d8ab1e4cbd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd8d7f0' },
      body: JSON.stringify(dbgAdv),
    }).catch(() => {})
    // #endregion

    if ('detail' in res) {
      setMessage(res.detail)
      return
    }

    setMessage(res.message)
    await load()
  }

  const pendingJudgement = slots.some((s) => s.review_status === 'submitted')
  const pendingCount = slots.filter((s) => s.review_status === 'submitted').length

  return (
    <div className="tribunal-panel">
      <header className="tribunal-header">
        <div className="tribunal-header-main">
          <p className="tribunal-eyebrow">Magistrate&apos;s bench</p>
          <h3 className="tribunal-title">Century tribunal</h3>
          <p className="tribunal-subtitle">
            Judge each sealed decree for this planning century. When no scroll awaits your seal, march Chronos forward to
            resolve the turn on the map.
          </p>
        </div>
        {turnNumber != null && (
          <div className="tribunal-century-seal" title={`Planning century ${turnNumber}`}>
            <span className="tribunal-century-seal-num">{turnNumber}</span>
            <span className="tribunal-century-seal-label">Century</span>
          </div>
        )}
      </header>

      <div className="tribunal-toolbar">
        <button
          type="button"
          className="tribunal-btn-ghost"
          onClick={() => {
            setMessage(null)
            setLoadBanner(null)
            void load()
          }}
          disabled={loading}
        >
          {loading ? 'Reading…' : 'Refresh clerks'}
        </button>
        <button
          type="button"
          className="tribunal-btn-march"
          onClick={() => void handleAdvance()}
          disabled={advancing || pendingJudgement}
          title={
            pendingJudgement
              ? 'Grant or deny every submitted decree first'
              : 'Resolve the turn and advance the calendar'
          }
        >
          {advancing ? 'Marching…' : 'March Chronos'}
        </button>
      </div>

      <div className="tribunal-body">
        {loadBanner && <p className="tribunal-notice tribunal-notice--err">{loadBanner}</p>}

        {!loadBanner && slots.length === 0 && (
          <p className="tribunal-notice tribunal-notice--muted">
            No decrees filed for this century. Students seal their actions from the map sidebar; they appear here as sealed
            scrolls.
          </p>
        )}

        {!loadBanner &&
          slots.length > 0 &&
          awaitingSlots.length === 0 &&
          resolvedSlots.length > 0 && (
            <p className="tribunal-notice tribunal-notice--ok">
              Every decree has been judged. Open the court ledger below to review, then march Chronos when ready.
            </p>
          )}

        {!loadBanner && draftOnly && (
          <p className="tribunal-notice tribunal-notice--muted">
            Scrolls exist for this century but none await tribunal — still draft or stale. Refresh after students submit, or
            inspect turn_action_slots in Supabase.
          </p>
        )}

        {pendingJudgement && (
          <p className="tribunal-notice tribunal-notice--warn">
            {pendingCount} decree{pendingCount === 1 ? '' : 's'} still await your seal — grant assent or deny each before
            marching time forward.
          </p>
        )}

        {message && (
          <div className="tribunal-notice tribunal-notice--info space-y-1">
            <p>{message}</p>
            <p className="opacity-70 text-[0.65rem]">
              Debug: session storage key <span className="font-mono">chronos_debug_tribunal</span>
            </p>
          </div>
        )}

        {awaitingSlots.length > 0 && (
          <>
            <div className="tribunal-divider" aria-hidden>
              ✦
            </div>
            <div className="space-y-3">
              {Array.from(groupedAwaiting.entries()).map(([civId, rows]) => (
                <div key={civId} className="tribunal-civ-block">
                  <div className="tribunal-civ-head">
                    <p className="tribunal-civ-name">
                      {rows[0]?.civilization?.group_name ?? `Court ${civId.slice(0, 8)}`}
                    </p>
                  </div>

                  <ul className="tribunal-decree-list">
                    {rows.map((row) => (
                      <li key={row.id} className="tribunal-decree">
                        <div className="tribunal-decree-meta">
                          <span className="tribunal-decree-slot">Decree {row.slot_index + 1}</span>
                          <span className="tribunal-decree-type">{actionTypeLabel(row.action_type)}</span>
                          <span className={reviewStatusClass(row.review_status)}>
                            {reviewStatusLabel(row.review_status)}
                          </span>
                        </div>

                        <p className="tribunal-decree-summary">{formatDecreeSummary(row, civNames)}</p>

                        <div className="tribunal-verdict-row">
                          <button
                            type="button"
                            className="tribunal-btn-grant"
                            disabled={busyId === row.id || row.review_status !== 'submitted'}
                            onClick={() => void setReview(row.id, 'approved')}
                          >
                            Grant assent
                          </button>
                          <button
                            type="button"
                            className="tribunal-btn-deny"
                            disabled={busyId === row.id || row.review_status !== 'submitted'}
                            onClick={() => void setReview(row.id, 'rejected')}
                          >
                            Deny
                          </button>
                        </div>

                        <details className="tribunal-amend">
                          <summary>Amend decree (JSON)</summary>
                          <div className="tribunal-amend-body">
                            Adjust coordinates or amounts, then seal the amendment. Use sparingly.
                            <OverwriteEditor
                              payload={JSON.stringify(
                                row.review_status === 'modified' && row.reviewed_payload
                                  ? row.reviewed_payload
                                  : row.payload,
                                null,
                                2,
                              )}
                              saving={busyId === row.id}
                              onSave={(text) => {
                                try {
                                  const parsed = JSON.parse(text) as Record<string, unknown>
                                  void setReview(row.id, 'modified', parsed)
                                } catch {
                                  alert('Invalid JSON — check commas and quotes.')
                                }
                              }}
                            />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        {resolvedSlots.length > 0 && (
          <details className="tribunal-audit">
            <summary>Court ledger — {resolvedSlots.length} ruled this century</summary>
            <div className="tribunal-audit-body space-y-4">
              {Array.from(groupedResolved.entries()).map(([civId, rows]) => (
                <div key={`r-${civId}`}>
                  <p className="tribunal-civ-name text-[0.68rem] mb-1.5">
                    {rows[0]?.civilization?.group_name ?? civId.slice(0, 8)}
                  </p>
                  {rows.map((row) => (
                    <div key={row.id} className="tribunal-audit-item">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <span className="tribunal-decree-slot">
                          Decree {row.slot_index + 1} · {actionTypeLabel(row.action_type)}
                        </span>
                        <span className={reviewStatusClass(row.review_status)}>
                          {reviewStatusLabel(row.review_status)}
                        </span>
                      </div>
                      <p className="tribunal-decree-summary text-[0.75rem] mt-1">{formatDecreeSummary(row, civNames)}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function OverwriteEditor({ payload, onSave, saving }: { payload: string; saving: boolean; onSave: (txt: string) => void }) {
  const [text, setText] = useState(payload)
  useEffect(() => setText(payload), [payload])
  return (
    <div className="flex flex-col">
      <textarea
        value={text}
        disabled={saving}
        rows={6}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        className="tribunal-textarea"
      />
      <button type="button" disabled={saving} onClick={() => onSave(text)} className="tribunal-btn-seal">
        Seal amendment
      </button>
    </div>
  )
}
