import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { advanceGameTurnTeacher } from '../lib/teacherAdvanceTurn'
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

export function TeacherTurnConsole({ gameId }: TeacherTurnConsoleProps) {
  const [slots, setSlots]                       = useState<QueueRow[]>([])
  const [turnNumber, setTurnNumber]             = useState<number | null>(null)
  const [loading, setLoading]                   = useState(false)
  const [busyId, setBusyId]                     = useState<string | null>(null)
  const [advancing, setAdvancing]               = useState(false)
  const [message, setMessage]                   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!gameId) return
    setLoading(true)
    setMessage(null)

    const { data: game, error: gErr } = await supabase.from('games').select('current_turn').eq('id', gameId).single()
    if (gErr || !game) {
      setLoading(false)
      setMessage(gErr?.message ?? 'Unable to read game calendar.')
      return
    }
    const t = typeof game.current_turn === 'number' ? game.current_turn : 1
    setTurnNumber(t)

    const [{ data: slotRows }, { data: civRows }] = await Promise.all([
      supabase.from('turn_action_slots').select('*').eq('game_id', gameId).eq('turn_number', t).order('civ_id'),
      supabase.from('civilizations').select('id, group_name').eq('game_id', gameId),
    ])

    setLoading(false)
    if (!slotRows) {
      setSlots([])
      return
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

    const { error } = await supabase
      .from('turn_action_slots')
      .update({
        review_status: status,
        ...(reviewedPayload ? { reviewed_payload: reviewedPayload } : {}),
      })
      .eq('id', rowId)

    setBusyId(null)

    if (error) setMessage(error.message)
    await load()
  }

  async function handleAdvance() {
    setAdvancing(true)
    setMessage(null)

    const res = await advanceGameTurnTeacher(gameId)
    setAdvancing(false)

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
            onClick={() => void load()}
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

      {slots.length === 0 && (
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
