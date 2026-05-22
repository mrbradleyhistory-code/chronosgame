import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export interface Civilization {
  id: string
  game_id: string
  group_name: string
  username: string
  resources: Record<string, number>
  territory: unknown
  techs: string[]
  policies: string[]
  action_points: number
  color: string
}

interface StudentContextValue {
  civ: Civilization | null
  login: (username: string, rawPin: string) => Promise<string | null>
  logout: () => void
}

const StudentContext = createContext<StudentContextValue | null>(null)

const STORAGE_KEY = 'chronos_student_civ'

export function StudentProvider({ children }: { children: ReactNode }) {
  const [civ, setCiv] = useState<Civilization | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? (JSON.parse(stored) as Civilization) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (civ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(civ))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [civ])

  async function login(username: string, rawPin: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('verify_student_pin', {
      p_username: username.toLowerCase().trim(),
      p_raw_pin: rawPin,
    })

    if (error) return error.message

    const rows = data as Civilization[] | null
    if (!rows || rows.length === 0) return 'Incorrect civilization name or PIN.'

    setCiv(rows[0])
    return null
  }

  function logout() {
    setCiv(null)
  }

  return (
    <StudentContext.Provider value={{ civ, login, logout }}>
      {children}
    </StudentContext.Provider>
  )
}

export function useStudent() {
  const ctx = useContext(StudentContext)
  if (!ctx) throw new Error('useStudent must be used within StudentProvider')
  return ctx
}
