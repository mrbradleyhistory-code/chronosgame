import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface Game {
  id: string
  name: string
  class_name: string
  status: string
}

interface Civ {
  id: string
  group_name: string
  username: string
  color: string
}

interface RevealedPin {
  civId: string
  civName: string
  pin: string
}

export function CivManager() {
  const { user } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [civs, setCivs] = useState<Civ[]>([])
  const [revealed, setRevealed] = useState<RevealedPin | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)

  const [showNewGame, setShowNewGame] = useState(false)
  const [newGameName, setNewGameName] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [creatingGame, setCreatingGame] = useState(false)

  const [newGroupName, setNewGroupName] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [addingCiv, setAddingCiv] = useState(false)
  const [settingStatus, setSettingStatus] = useState(false)

  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null

  useEffect(() => {
    if (user) loadGames()
  }, [user])

  useEffect(() => {
    if (selectedGameId) loadCivs(selectedGameId)
    else setCivs([])
  }, [selectedGameId])

  async function loadGames() {
    const { data } = await supabase
      .from('games')
      .select('id, name, class_name, status')
      .order('created_at', { ascending: false })
    if (data) {
      setGames(data)
      if (data.length > 0) setSelectedGameId((prev) => prev || data[0].id)
    }
  }

  async function loadCivs(gameId: string) {
    const { data } = await supabase
      .from('civilizations')
      .select('id, group_name, username, color')
      .eq('game_id', gameId)
      .order('group_name')
    if (data) setCivs(data)
  }

  async function handleResetPin(civ: Civ) {
    setResettingId(civ.id)
    const { data, error } = await supabase.rpc('reset_civ_pin', { p_civ_id: civ.id })
    setResettingId(null)
    if (error) { alert(error.message); return }
    setRevealed({ civId: civ.id, civName: civ.group_name, pin: data as string })
  }

  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault()
    setCreatingGame(true)
    const { data, error } = await supabase
      .from('games')
      .insert({ name: newGameName, class_name: newClassName, teacher_id: user!.id })
      .select('id, name, class_name, status')
      .single()
    setCreatingGame(false)
    if (error) { alert(error.message); return }
    setGames((prev) => [data, ...prev])
    setSelectedGameId(data.id)
    setNewGameName('')
    setNewClassName('')
    setShowNewGame(false)
  }

  async function handleSetStatus(status: string) {
    setSettingStatus(true)
    const { error } = await supabase
      .from('games')
      .update({ status })
      .eq('id', selectedGameId)
    setSettingStatus(false)
    if (error) { alert(error.message); return }
    setGames((prev) =>
      prev.map((g) => (g.id === selectedGameId ? { ...g, status } : g))
    )
  }

  async function handleAddCiv(e: React.FormEvent) {
    e.preventDefault()
    setAddingCiv(true)
    const { data, error } = await supabase.rpc('create_civ_with_pin', {
      p_game_id: selectedGameId,
      p_username: newUsername.toLowerCase().trim(),
      p_group_name: newGroupName.trim(),
      p_color: newColor,
    })
    setAddingCiv(false)
    if (error) { alert(error.message); return }
    const row = (data as { civ_id: string; pin: string }[])[0]
    setRevealed({ civId: row.civ_id, civName: newGroupName, pin: row.pin })
    setNewGroupName('')
    setNewUsername('')
    setNewColor('#6366f1')
    loadCivs(selectedGameId)
  }

  return (
    <div>
      {/* ── game selector ── */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={selectedGameId}
          onChange={(e) => setSelectedGameId(e.target.value)}
          className="flex-1 min-w-0 rounded bg-slate-700 border border-slate-600 px-3 py-1.5 text-sm text-white"
        >
          {games.length === 0 && <option value="">No games yet</option>}
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} — {g.class_name} [{g.status}]
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowNewGame((v) => !v)}
          className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 transition-colors"
        >
          + Game
        </button>
      </div>

      {/* ── game status bar ── */}
      {selectedGame && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            selectedGame.status === 'active'  ? 'bg-green-900/50 text-green-300 border border-green-700' :
            selectedGame.status === 'paused'  ? 'bg-slate-700 text-slate-300 border border-slate-500' :
            selectedGame.status === 'ended'   ? 'bg-slate-800 text-slate-500 border border-slate-700' :
            selectedGame.status === 'review'  ? 'bg-blue-900/50 text-blue-300 border border-blue-700' :
                                                'bg-amber-900/50 text-amber-300 border border-amber-700'
          }`}>
            {selectedGame.status === 'paused' ? '⏸ paused' :
             selectedGame.status === 'active' ? '● active' :
             selectedGame.status}
          </span>

          {/* lobby: first-ever start */}
          {selectedGame.status === 'lobby' && (
            <button
              onClick={() => handleSetStatus('active')}
              disabled={settingStatus}
              className="rounded bg-green-700 px-3 py-1 text-xs font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              {settingStatus ? 'Starting…' : '▶ Start Game'}
            </button>
          )}

          {/* active: end today's session (pauses, not permanent) */}
          {selectedGame.status === 'active' && (
            <button
              onClick={() => handleSetStatus('paused')}
              disabled={settingStatus}
              className="rounded bg-slate-600 border border-slate-500 px-3 py-1 text-xs font-semibold hover:bg-slate-500 disabled:opacity-50 transition-colors"
            >
              {settingStatus ? 'Pausing…' : '⏸ End Session'}
            </button>
          )}

          {/* paused: resume next class day */}
          {selectedGame.status === 'paused' && (
            <button
              onClick={() => handleSetStatus('active')}
              disabled={settingStatus}
              className="rounded bg-green-700 px-3 py-1 text-xs font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              {settingStatus ? 'Resuming…' : '▶ Resume Session'}
            </button>
          )}

          {/* active or paused: end permanently (end of semester) */}
          {(selectedGame.status === 'active' || selectedGame.status === 'paused') && (
            <button
              onClick={() => {
                if (confirm('End this game permanently? Students will no longer be able to log in.')) {
                  handleSetStatus('ended')
                }
              }}
              disabled={settingStatus}
              className="rounded bg-red-900/40 border border-red-800 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-900/60 disabled:opacity-50 transition-colors"
            >
              End Game Permanently
            </button>
          )}
        </div>
      )}

      {/* ── new game form ── */}
      {showNewGame && (
        <form
          onSubmit={handleCreateGame}
          className="mb-4 rounded-lg border border-slate-600 bg-slate-700/60 p-4 flex flex-col gap-2.5"
        >
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">New Game</p>
          <input
            value={newGameName}
            onChange={(e) => setNewGameName(e.target.value)}
            placeholder="Game name"
            required
            className="rounded bg-slate-600 border border-slate-500 px-3 py-1.5 text-sm text-white placeholder-slate-400"
          />
          <input
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            placeholder="Class (e.g. Period 3)"
            required
            className="rounded bg-slate-600 border border-slate-500 px-3 py-1.5 text-sm text-white placeholder-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creatingGame}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {creatingGame ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowNewGame(false)}
              className="rounded bg-slate-600 px-3 py-1.5 text-sm hover:bg-slate-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── PIN reveal banner ── */}
      {revealed && (
        <div className="mb-4 rounded-lg border border-amber-500/60 bg-amber-950/30 p-4">
          <p className="text-sm font-semibold text-amber-300">
            PIN for <span className="font-bold">{revealed.civName}</span>
          </p>
          <p className="mt-1.5 font-mono text-4xl font-bold tracking-[0.35em] text-amber-100 select-all">
            {revealed.pin}
          </p>
          <p className="mt-1 text-xs text-amber-400/80">
            Copy this now — it won't be shown again.
          </p>
          <button
            onClick={() => setRevealed(null)}
            className="mt-2 text-xs text-amber-500 hover:text-amber-400"
          >
            ✕ Dismiss
          </button>
        </div>
      )}

      {/* ── civ list ── */}
      {selectedGameId && (
        <>
          <div className="space-y-1.5 mb-4">
            {civs.length === 0 && (
              <p className="text-sm text-slate-500 italic py-2">No civilizations yet.</p>
            )}
            {civs.map((civ) => (
              <div
                key={civ.id}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-700/40 px-4 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: civ.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{civ.group_name}</p>
                    <p className="text-xs text-slate-400">@{civ.username}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleResetPin(civ)}
                  disabled={resettingId === civ.id}
                  className="shrink-0 ml-3 rounded bg-slate-600 px-3 py-1 text-xs hover:bg-slate-500 disabled:opacity-50 transition-colors"
                >
                  {resettingId === civ.id ? 'Resetting…' : 'Reset PIN'}
                </button>
              </div>
            ))}
          </div>

          {/* ── add civ form ── */}
          <form
            onSubmit={handleAddCiv}
            className="rounded-lg border border-slate-600 bg-slate-700/60 p-4 flex flex-col gap-2.5"
          >
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Add Civilization
            </p>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name (e.g. Athens)"
              required
              className="rounded bg-slate-600 border border-slate-500 px-3 py-1.5 text-sm text-white placeholder-slate-400"
            />
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Login name (e.g. athens)"
              required
              className="rounded bg-slate-600 border border-slate-500 px-3 py-1.5 text-sm text-white placeholder-slate-400"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 shrink-0">Color</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent"
              />
              <span className="text-xs text-slate-500 font-mono">{newColor}</span>
            </div>
            <button
              type="submit"
              disabled={addingCiv}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {addingCiv ? 'Adding…' : '+ Add Civilization'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
