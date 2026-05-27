import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { advanceGameTurnTeacher } from '../lib/teacherAdvanceTurn'
import { coerceGameTurn } from '../lib/coerceTurn'
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

function coerceTeacherReviewRpcResult(raw: unknown): TeacherReviewRpcEnvelope | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    try {
      return coerceTeacherReviewRpcResult(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
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

export function TeacherTurnConsole({ gameId }: TeacherTurnConsoleProps) {
  const [slots, setSlots]                       = useState<QueueRow[]>([])
  const [turnNumber, setTurnNumber]             = useState<number | null>(null)
  const [loading, setLoading]                   = useState(false)
  const [busyId, setBusyId]                     = useState<string | null>(null)
  const [advancing, setAdvancing]               = useState(false)
  const [message, setMessage]                   = useState<string | null>(null)
  const [loadBanner, setLoadBanner]            = useState<string | null>(null)

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

    const [{ data: slotRows, error: slotErr }, { data: civRows, error: civErr }] = await Promise.all([
      supabase.from('turn_action_slots').select('*').eq('game_id', gameId).eq('turn_number', t).order('civ_id'),
      supabase.from('civilizations').select('id, group_name').eq('game_id', gameId),
    ])

    const slotQueryErrText = slotErr ? flattenSupabaseError(slotErr) : null
    const civQueryErrText = civErr ? flattenSupabaseError(civErr) : null

    setLoading(false)

    if (slotErr) {
      const line = flattenSupabaseError(slotErr)
      setLoadBanner(`Could not load decree scrolls: ${line}`)
      setSlots([])
      // #region agent log
      {
        const dbgLoad = {
          sessionId: 'd8d7f0',
          runId: 'post-fix-5',
          hypothesisId: 'C',
          location: 'TeacherTurnConsole.tsx:load',
          message: 'tribunal load slot query failed',
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

    const rawSlots = slotRows ?? []
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
        const rs = typeof (r as { review_status?: string }).review_status === 'string' ? (r as { review_status: string }).review_status : '?'
        acc[rs] = (acc[rs] ?? 0) + 1
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
          slotTurnNumsSample: rawSlots.slice(0, 5).map((r) => (r as { turn_number?: number }).turn_number),
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
    if (!slotRows) {
      setSlots([])
      setLoadBanner(nextLoadBanner)
      return
    }

    if (civErr && rawSlots.length > 0) {
      setLoadBanner(
        `Loaded decrees but civilisation names failed to load: ${flattenSupabaseError(civErr)} — scrolls still show below.`,
      )
    } else {
      setLoadBanner(nextLoadBanner)
    }
    const civMap = Object.fromEntries((civRows ?? []).map((c) => [c.id, c]))

    setSlots(
      (slotRows as TurnActionSlotRow[]).map((row) => ({
        ...row,
        civilization: civMap[row.civ_id] ?? null,
      })),
    )
  }, [gameId])

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
  }, [gameId, load])

  const grouped = useMemo(() => {
    const map = new Map<string, QueueRow[]>()
    slots.forEach((row) => {
      const bucket = map.get(row.civ_id)
      if (bucket) bucket.push(row)
      else map.set(row.civ_id, [row])
    })
    map.forEach((arr) => arr.sort((a, b) => a.slot_index - b.slot_index))
    return map
  }, [slots])

  async function setReview(rowId: string, status: QueueRow['review_status'], reviewedPayload?: Record<string, unknown>) {
    setBusyId(rowId)
    setMessage(null)

    // Security-definer RPC — avoids RLS silent 0-row updates on turn_action_slots (see supabase-teacher-review.sql).
    const { data: rpcRaw, error: rpcErr } = await supabase.rpc('teacher_review_slot', {
      p_slot_id: rowId,
      p_status: status,
      p_reviewed_payload: reviewedPayload ?? null,
    })

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
      const msg =
        code === 'unauthorized'
          ? 'Not authorised to judge this decree (sign in as the teacher who owns this game).'
          : code === 'slot_not_found'
            ? 'Decree scroll not found — refresh clerks.'
            : code === 'invalid_status'
              ? 'Invalid tribunal ruling.'
              : code != null
                ? `Tribunal could not seal (${code}). If you just deployed, run supabase-teacher-review.sql in the Supabase SQL editor.`
                : 'Tribunal response was unexpected — refresh and try again.'
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

  return (
    <div className="rounded-xl border border-slate-600 bg-slate-800 p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Century tribunal</h3>
          <p className="text-xs text-slate-400 mt-1">
            Review each sealed decree ({turnNumber != null ? `planning Century ${turnNumber}` : 'fetching parchment…'})
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => {
              setMessage(null)
              setLoadBanner(null)
              void load()
            }}
            disabled={loading}
            className="rounded-lg border border-slate-500 px-3 py-1 text-xs uppercase tracking-wide hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? 'Reading…' : 'Refresh clerks'}
          </button>
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || pendingJudgement}
            className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-black hover:bg-amber-500 disabled:opacity-40"
            title={
              pendingJudgement
                ? 'Resolve unsubmitted rulings'
                : 'Runs TRADE→BUILD→RESEARCH→EXPLORE→EXPAND→ATTACK phases, retrains economies, wipes resolved scrolls.'
            }
          >
            {advancing ? 'Advancing eras…' : 'Advance Chronos'}
          </button>
        </div>
      </div>

      {loadBanner && (
        <p className="text-xs text-rose-200 border border-rose-900/80 bg-rose-950/35 rounded px-3 py-2">{loadBanner}</p>
      )}

      {slots.length === 0 && !loadBanner && (
        <p className="text-xs text-slate-500 italic">No student scrolls lodged for review — fleets yet idle.</p>
      )}

      {pendingJudgement && (
        <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/70 rounded px-3 py-2">
          Crimson ribbon still tied — judge every decree before marching time forward ({slots.filter((s) => s.review_status === 'submitted').length} awaiting).
        </p>
      )}

      {message && (
        <p className="text-xs text-sky-300 border border-slate-700 bg-slate-900/70 rounded px-3 py-2">{message}</p>
      )}

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([civId, rows]) => (
          <div key={civId} className="rounded-xl border border-slate-700 p-4 space-y-3">
            <p className="text-sm font-semibold text-white">
              {rows[0]?.civilization?.group_name ?? civId.slice(0, 6)}
            </p>

            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg bg-slate-900/70 border border-slate-700 p-3 space-y-2">
                  <div className="flex justify-between gap-2 items-start flex-wrap">
                    <p className="text-xs uppercase text-slate-300">
                      Slot {row.slot_index + 1}: <span className="text-white font-semibold">{row.action_type}</span>
                      <span className="ml-2 text-slate-500">{row.review_status}</span>
                    </p>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {(row.payload as Record<string, unknown>)?.q != null &&
                      (row.payload as Record<string, unknown>)?.r != null
                        ? `(${String((row.payload as Record<string, unknown>).q)},${String((row.payload as Record<string, unknown>).r)})`
                        : 'coords via map lore'}
                    </span>
                  </div>
                  <pre className="text-[11px] text-slate-400 whitespace-pre-wrap break-all">
                    {JSON.stringify(row.payload ?? {}, null, 2)}
                  </pre>

                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void setReview(row.id, 'approved')}
                      className="rounded bg-emerald-800/70 border border-emerald-600 px-2 py-1 text-[11px] hover:bg-emerald-700 disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void setReview(row.id, 'rejected')}
                      className="rounded bg-rose-900/70 border border-rose-800 px-2 py-1 text-[11px] hover:bg-rose-800 disabled:opacity-40"
                    >
                      Reject
                    </button>
                    <OverwriteEditor
                      key={row.id}
                      payload={JSON.stringify(row.review_status === 'modified' && row.reviewed_payload ? row.reviewed_payload : row.payload, null, 2)}
                      saving={busyId === row.id}
                      onSave={(text) => {
                        try {
                          const parsed = JSON.parse(text) as Record<string, unknown>
                          void setReview(row.id, 'modified', parsed)
                        } catch {
                          alert('Malformed JSON parchment — revise carefully.')
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OverwriteEditor({ payload, onSave, saving }: { payload: string; saving: boolean; onSave: (txt: string) => void }) {
  const [text, setText] = useState(payload)
  useEffect(() => setText(payload), [payload])
  return (
    <div className="flex-1 flex flex-col gap-1 min-w-[200px]">
      <textarea
        value={text}
        disabled={saving}
        rows={5}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-slate-600 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-200 font-mono"
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => onSave(text)}
        className="self-end rounded bg-amber-500/20 border border-amber-700 px-3 py-1 text-[11px] text-amber-200 hover:bg-amber-500/35 disabled:opacity-40"
      >
        Seal modification
      </button>
    </div>
  )
}
