import { useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { CivManager } from '../components/CivManager'
import { MapCanvas } from '../components/MapCanvas'
import { TeacherTurnConsole } from '../components/TeacherTurnConsole'
import { supabase } from '../lib/supabase'
import { generateMap, randomSeed } from '../lib/mapGen'
import { MAP_SIZE_OPTIONS, type HexMapData } from '../lib/hexUtils'
import { applyCivSpawnsToGameMap } from '../lib/ensureGameMapSpawns'
import { PRESET_MAPS, generatePreset } from '../lib/presetMaps'

export default function TeacherPage() {
  const { user, signInWithGoogle, signOut, loading } = useAuth()

  const [activeGameId, setActiveGameId]       = useState('')
  const [previewMap, setPreviewMap]           = useState<HexMapData | null>(null)
  const [currentSeed, setCurrentSeed]         = useState('')
  const [isLocked, setIsLocked]               = useState(false)
  const [saving, setSaving]                   = useState(false)
  const [sizeIdx, setSizeIdx]                 = useState(2) // default: Standard
  const [presetId, setPresetId]               = useState('')
  const selectedSize = MAP_SIZE_OPTIONS[sizeIdx]

  // Called when MapCanvas finishes loading from DB
  const handleMapLoaded = useCallback((map: HexMapData) => {
    setPreviewMap(null) // clear any preview — DB version is canonical
    setIsLocked(true)
    void map
  }, [])

  function handleGameSelect(id: string) {
    setActiveGameId(id)
    setPreviewMap(null)   // reset preview when switching games
    setIsLocked(false)    // will be set by onMapLoaded if DB has a map
    setCurrentSeed('')
  }

  function handleRegenerate() {
    setPresetId('')
    const seed = randomSeed()
    setCurrentSeed(seed)
    const map = generateMap(seed, selectedSize.cols, selectedSize.rows)
    setPreviewMap(map)
    setIsLocked(false)
  }

  function handleLoadPreset(id: string) {
    setPresetId(id)
    if (!id) return
    const map = generatePreset(id)
    if (!map) return
    setCurrentSeed(`preset-${id}`)
    setPreviewMap(map)
    setIsLocked(false)
  }

  async function handleLock() {
    if (!previewMap || !activeGameId) return
    setSaving(true)

    const [{ data: civRows }, { error: updateErr }] = await Promise.all([
      supabase.from('civilizations').select('id').eq('game_id', activeGameId),
      supabase
        .from('games')
        .update({ hex_map: previewMap, world_seed: currentSeed })
        .eq('id', activeGameId),
    ])

    if (updateErr) {
      setSaving(false)
      alert(updateErr.message)
      return
    }

    const civIds = (civRows ?? []).map((c) => c.id)
    await applyCivSpawnsToGameMap(activeGameId, previewMap, civIds, currentSeed || activeGameId, true)

    setSaving(false)
    setIsLocked(true)
  }

  async function handleUnlock() {
    if (!activeGameId) return
    if (!confirm('Regenerate will replace the current map. Continue?')) return
    setSaving(true)
    await supabase.from('games').update({ hex_map: null }).eq('id', activeGameId)
    setSaving(false)
    setIsLocked(false)
    setPreviewMap(null)
    // trigger a fresh generation
    setTimeout(handleRegenerate, 0)
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-900 text-white"><p>Loading…</p></div>
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-slate-900 text-white">
        <h1 className="text-3xl font-bold">Chronos — Teacher Portal</h1>
        <p className="text-slate-400">Sign in with your Google account to manage games.</p>
        <button onClick={signInWithGoogle} className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold hover:bg-indigo-500 transition-colors">
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold">Teacher Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user.email}</span>
          <button onClick={signOut} className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600 transition-colors">Sign out</button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-slate-700 p-4 space-y-5">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-300 uppercase tracking-wide">Civilizations &amp; PINs</h2>
            <CivManager onGameSelect={handleGameSelect} />
          </div>

          {activeGameId && <TeacherTurnConsole gameId={activeGameId} />}

          {activeGameId && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">World Map</h2>

              {/* Preset maps */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Preset map</label>
                <select
                  value={presetId}
                  onChange={e => handleLoadPreset(e.target.value)}
                  disabled={isLocked}
                  className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  <option value="">— procedural —</option>
                  {PRESET_MAPS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {presetId && (
                  <p className="mt-1 text-xs text-slate-500">
                    {PRESET_MAPS.find(p => p.id === presetId)?.description}
                  </p>
                )}
              </div>

              {/* Map size selector (only for procedural) */}
              {!presetId && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Map size</label>
                  <select
                    value={sizeIdx}
                    onChange={e => setSizeIdx(Number(e.target.value))}
                    disabled={isLocked}
                    className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {MAP_SIZE_OPTIONS.map((opt, i) => (
                      <option key={i} value={i}>{opt.label} — {opt.civHint}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Status + actions */}
              {isLocked ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-400" />
                    <span className="text-xs text-green-300">Map locked</span>
                  </div>
                  <button
                    onClick={handleUnlock}
                    disabled={saving}
                    className="w-full rounded bg-slate-600 border border-slate-500 px-3 py-1.5 text-xs hover:bg-slate-500 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Working…' : 'Regenerate (replaces current)'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {previewMap ? (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                      <span className="text-xs text-amber-300">Preview — not saved</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-slate-500" />
                      <span className="text-xs text-slate-400">No map yet</span>
                    </div>
                  )}
                  {!presetId && (
                    <button
                      onClick={handleRegenerate}
                      className="w-full rounded bg-indigo-700 border border-indigo-600 px-3 py-1.5 text-xs hover:bg-indigo-600 transition-colors"
                    >
                      {previewMap ? '↻ Try another seed' : 'Generate map'}
                    </button>
                  )}
                  {previewMap && (
                    <button
                      onClick={handleLock}
                      disabled={saving}
                      className="w-full rounded bg-green-700 px-3 py-1.5 text-xs font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      {saving ? 'Saving…' : '✓ Lock this map'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {(['Question Sets', 'Review Sessions'] as const).map(section => (
              <div key={section} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <h2 className="mb-1 text-sm font-semibold">{section}</h2>
                <p className="text-xs text-slate-400">Coming soon.</p>
              </div>
            ))}
          </div>
        </aside>

        {/* Map canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-700 px-4 py-2 flex items-center gap-2 text-sm text-slate-400">
            World Map
            {!activeGameId && <span className="text-xs text-slate-600">— select a game to view</span>}
            {previewMap && !isLocked && <span className="text-xs text-amber-400 ml-2">preview</span>}
            {isLocked && <span className="text-xs text-green-400 ml-2">locked</span>}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeGameId ? (
              <MapCanvas
                viewMode="teacher"
                gameId={activeGameId}
                previewMap={previewMap}
                onMapLoaded={handleMapLoaded}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-600 text-sm">No game selected</div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
