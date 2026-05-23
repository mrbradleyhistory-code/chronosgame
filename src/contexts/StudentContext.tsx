import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { TurnActionSlotRow } from '../types/actions'

const STORAGE_KEY = 'chronos_student_civ'
const PIN_SESSION_KEY = 'chronos_student_pin_pair'

export interface Civilization {
  id: string
  game_id: string
  group_name: string
  username: string
  resources: Record<string, unknown>
  territory: unknown
  techs: string[]
  policies: string[]
  action_points: number
  color: string
  buildings?: unknown
}

export interface StudentPlayBundle {
  civ: Civilization
  queue: TurnActionSlotRow[]
  game: {
    id: string
    current_turn: number
    status: string
    settings: unknown
  }
}

interface CredPair {
  username: string
  pin: string
}

interface StudentContextValue {
  civ: Civilization | null
  login: (username: string, rawPin: string) => Promise<string | null>
  logout: () => void
  pullPlayState: () => Promise<{ error: string } | { data: StudentPlayBundle }>
  submitTurnDraft: (
    slots: Array<{ slot_index: number; action_type: string; payload: Record<string, unknown> }>,
  ) => Promise<string | null>
}

const StudentContext = createContext<StudentContextValue | null>(null)

function restoreCredFromSession(): CredPair | null {
  try {
    const stored = sessionStorage.getItem(PIN_SESSION_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as { username?: string; pin?: string }
    if (!parsed.username || !parsed.pin) return null
    return { username: parsed.username.toLowerCase().trim(), pin: parsed.pin }
  } catch {
    return null
  }
}

function persistCredToSession(pair: CredPair | null) {
  if (!pair) {
    sessionStorage.removeItem(PIN_SESSION_KEY)
    return
  }
  sessionStorage.setItem(PIN_SESSION_KEY, JSON.stringify(pair))
}

export function StudentProvider({ children }: { children: ReactNode }) {
  const credRef = useRef<CredPair | null>(restoreCredFromSession())

  const [civ, setCiv] = useState<Civilization | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? (JSON.parse(stored) as Civilization) : null
    } catch {
      return null
    }
  })

  /** If PIN session missing but cached civ survives, purge stale atlas cache */
  useEffect(() => {
    if (civ && !credRef.current) {
      setCiv(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (civ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(civ))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [civ])

  const hydrateFromRpcBlob = useCallback((blob: unknown): StudentPlayBundle | null => {
    if (!blob || typeof blob !== 'object') return null
    const o = blob as Record<string, unknown>
    const game = o.game
    const qciv = o.civ
    const queueUnknown = o.queue
    if (!game || typeof game !== 'object' || !qciv || typeof qciv !== 'object') return null
    const g = game as Record<string, unknown>
    const c = qciv as Record<string, unknown>
    const civTyped: Civilization = {
      id: c.id as string,
      game_id: c.game_id as string,
      group_name: c.group_name as string,
      username: c.username as string,
      resources: (c.resources as Record<string, unknown>) ?? {},
      territory: c.territory,
      techs: Array.isArray(c.techs)
        ? (c.techs as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
      policies: Array.isArray(c.policies)
        ? (c.policies as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
      action_points: typeof c.action_points === 'number' ? c.action_points : 3,
      color: typeof c.color === 'string' ? c.color : '#6366f1',
      ...(c.buildings !== undefined ? { buildings: c.buildings } : {}),
    }

    const queue: TurnActionSlotRow[] = Array.isArray(queueUnknown) ? (queueUnknown as TurnActionSlotRow[]) : []

    return {
      civ: civTyped,
      queue,
      game: {
        id: g.id as string,
        current_turn: typeof g.current_turn === 'number' ? g.current_turn : 1,
        status: typeof g.status === 'string' ? g.status : 'paused',
        settings: g.settings ?? {},
      },
    }
  }, [])

  async function login(username: string, rawPin: string): Promise<string | null> {
    const u = username.toLowerCase().trim()
    const { data, error } = await supabase.rpc('verify_student_pin', {
      p_username: u,
      p_raw_pin: rawPin,
    })

    if (error) return error.message

    const rows = data as Civilization[] | null
    if (!rows || rows.length === 0) return 'Incorrect civilization name or PIN.'

    const pair = { username: u, pin: rawPin }
    credRef.current = pair
    persistCredToSession(pair)
    setCiv(rows[0])
    return null
  }

  function logout() {
    credRef.current = null
    persistCredToSession(null)
    setCiv(null)
  }

  const pullPlayState = useCallback(async (): Promise<{ error: string } | { data: StudentPlayBundle }> => {
    const cred = credRef.current ?? restoreCredFromSession()
    if (cred && !credRef.current) credRef.current = cred
    if (!cred)
      return { error: 'No ink in the reed — leave the realm and sign in anew.' }

    const { data, error } = await supabase.rpc('get_student_play_state', {
      p_username: cred.username,
      p_raw_pin: cred.pin,
    })

    if (error) return { error: error.message }

    const bundle = hydrateFromRpcBlob(data as unknown)
    if (!bundle) return { error: 'Oracle returned blank tablets.' }

    setCiv(bundle.civ)
    return { data: bundle }
  }, [hydrateFromRpcBlob])

  const submitTurnDraft = useCallback(
    async (
      slots: Array<{ slot_index: number; action_type: string; payload: Record<string, unknown> }>,
    ): Promise<string | null> => {
      const cred = credRef.current ?? restoreCredFromSession()
      if (cred && !credRef.current) credRef.current = cred
      if (!cred) return 'Session vanished — reopen the seals with your PIN.'

      const { error } = await supabase.rpc('submit_turn_queue', {
        p_username: cred.username,
        p_raw_pin: cred.pin,
        p_slots: slots,
      })

      return error?.message ?? null
    },
    [],
  )

  return (
    <StudentContext.Provider value={{ civ, login, logout, pullPlayState, submitTurnDraft }}>
      {children}
    </StudentContext.Provider>
  )
}

export function useStudent() {
  const ctx = useContext(StudentContext)
  if (!ctx) throw new Error('useStudent must be used within StudentProvider')
  return ctx
}
