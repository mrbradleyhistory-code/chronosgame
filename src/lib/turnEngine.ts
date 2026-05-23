import type { Civilization } from '../contexts/StudentContext'
import type { HexMapData, HexCell } from './hexUtils'
import { getCellAt, oddRNeighbors, isAdjacentToCivOwnership } from './hexUtils'
import type { CombatLogEntry } from '../types/combat'
import { resolveCombatDiceBattle } from './combatResolution'
import { calculateStatsForTurn, parseCivResources } from './statsCalc'
import type { CivResources, GameSettings } from '../types/resources'
import { parseGameSettings, serializeCivResources } from '../types/resources'
import type { QueueActionType, TurnActionSlotRow } from '../types/actions'
import { BUILDING_DEFS, bonusActionPointsFromCiv, ADOPTABLE_POLICY_IDS } from './gameContent'
import {
  civilizationHasTechAction,
  civilizationMayBuild,
  eraOpensOnTurn,
  getTechDefinition,
  prerequisitesMet,
} from './techTree'

/** Max AP budget during planning phase (queued actions must fit). */
export function maxActionPointsForCiv(settings: GameSettings, techs: string[], policies: string[]): number {
  return settings.baseActionPoints + bonusActionPointsFromCiv(techs, policies)
}

const PHASE_ORDER: Record<QueueActionType, number> = {
  ENACT_POLICY: 0,
  TRADE: 1,
  BUILD: 2,
  RESEARCH: 3,
  EXPLORE: 4,
  EXPAND: 5,
  ATTACK: 6,
}

export type ActionOutcomeStatus = 'ok' | 'failed' | 'skipped'

export interface ActionOutcome {
  civId: string
  civName: string
  slotIndex: number
  actionType: QueueActionType
  status: ActionOutcomeStatus
  message: string
  detail?: Record<string, unknown>
}

export interface ResolvedTurnArtifacts {
  map: HexMapData
  civilizationPatches: Record<string, Record<string, unknown>>
  events: ActionOutcome[]
  turnEventsJson: unknown[]
  combatLog: CombatLogEntry[]
}

type MutableSnapshot = {
  id: string
  group_name: string
  resources: CivResources
  techs: Set<string>
  policies: Set<string>
  buildings: { q: number; r: number; buildingId: string }[]
}

function cloneDeepCells(cells: HexCell[]): HexCell[] {
  return cells.map((c) => ({
    ...c,
    explored_by: [...c.explored_by],
  }))
}

/** Reveal fog for `civId` on `(q,r)` plus its valid neighbours */
function revealAround(map: HexMapData, civId: string, q: number, r: number) {
  const targets = [...oddRNeighbors(q, r, map.cols, map.rows), { q, r }]
  for (const coord of targets) {
    const cell = map.cells[coord.r * map.cols + coord.q]
    if (!cell || cell.explored_by.includes(civId)) continue
    cell.explored_by = [...cell.explored_by, civId]
  }
}

/** True if `civId` may unveil `(q,r)` from an owned or mapped neighbour without entering rival soil. */
function canScoutFromFrontier(map: HexMapData, civId: string, q: number, r: number): boolean {
  const tgt = getCellAt(map, q, r)
  if (!tgt) return false
  if (tgt.owner && tgt.owner !== civId) return false
  if (tgt.explored_by.includes(civId)) return false

  for (const nb of oddRNeighbors(q, r, map.cols, map.rows)) {
    const n = getCellAt(map, nb.q, nb.r)
    if (!n) continue
    if (n.owner === civId) return true
    if (n.explored_by.includes(civId)) return true
  }
  return false
}

function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function coerceNum(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.floor(raw)
  return null
}

function parseBuildings(raw: unknown): { q: number; r: number; buildingId: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { q: number; r: number; buildingId: string }[] = []
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue
    const o = b as Record<string, unknown>
    const q = o.q,
      r = o.r,
      id = o.buildingId
    if (typeof q !== 'number' || typeof r !== 'number' || typeof id !== 'string') continue
    out.push({ q, r, buildingId: id })
  }
  return out
}

export function queuedActionCost(type: QueueActionType, payload: Record<string, unknown>): number | null {
  switch (type) {
    case 'EXPAND':
      return 1
    case 'ATTACK':
      return 2
    case 'TRADE':
      return 1
    case 'RESEARCH':
      return 1
    case 'EXPLORE':
      return 1
    case 'ENACT_POLICY':
      return 1
    case 'BUILD': {
      const id = typeof payload.buildingId === 'string' ? payload.buildingId : ''
      const def = BUILDING_DEFS[id]
      return def ? def.apCost : null
    }
    default:
      return null
  }
}

export function queuedActionsSpendAp(actions: Array<{ action_type: QueueActionType; payload: Record<string, unknown> }>): number {
  let total = 0
  for (const a of actions) {
    const c = queuedActionCost(a.action_type, a.payload)
    if (c != null) total += c
  }
  return total
}

/** Prefer teacher-edited payloads when populated; otherwise the student submission. */
export function effectiveQueuedPayload(slot: Pick<TurnActionSlotRow, 'payload' | 'reviewed_payload' | 'review_status'>): Record<string, unknown> {
  const rp = slot.reviewed_payload
  if (rp && typeof rp === 'object' && Object.keys(rp as object).length > 0) {
    return rp as Record<string, unknown>
  }
  return slot.payload ?? {}
}

function snapshotMutable(civRow: Civilization): MutableSnapshot {
  return {
    id: civRow.id,
    group_name: civRow.group_name,
    resources: parseCivResources(civRow.resources as Record<string, unknown>),
    techs: new Set(coerceStringArray(civRow.techs as unknown)),
    policies: new Set(coerceStringArray(civRow.policies as unknown)),
    buildings: parseBuildings((civRow as { buildings?: unknown }).buildings ?? []),
  }
}

function ownedTilesCount(map: HexMapData, civId: string): number {
  return map.cells.filter((c) => c.owner === civId).length
}

/** Advance hex map ownership + queued actions, then regenerate economy snapshots for Supabase PATCH rows */
export function resolveTurnForGame(args: {
  gameId: string
  map: HexMapData
  civilizationRows: Civilization[]
  settingsUnknown: unknown
  queueRows: TurnActionSlotRow[]
  turnNumberBeingResolved: number
}): ResolvedTurnArtifacts {
  const settings = parseGameSettings(args.settingsUnknown)
  let map: HexMapData = { cols: args.map.cols, rows: args.map.rows, cells: cloneDeepCells(args.map.cells) }
  const events: ActionOutcome[] = []
  const combatLog: CombatLogEntry[] = []

  const snap = new Map<string, MutableSnapshot>()
  for (const c of args.civilizationRows) {
    snap.set(c.id, snapshotMutable(c))
  }

  const civNameOf = (id: string) => snap.get(id)?.group_name ?? id

  const approvedRows = args.queueRows.filter(
    (r) =>
      r.turn_number === args.turnNumberBeingResolved &&
      (r.review_status === 'approved' || r.review_status === 'modified'),
  )

  const sortedSlots = [...approvedRows].sort((a, b) => {
    const ta = PHASE_ORDER[a.action_type as QueueActionType] ?? 99
    const tb = PHASE_ORDER[b.action_type as QueueActionType] ?? 99
    if (ta !== tb) return ta - tb
    const nameCmp = civNameOf(a.civ_id).localeCompare(civNameOf(b.civ_id))
    if (nameCmp !== 0) return nameCmp
    return a.slot_index - b.slot_index
  })

  const pushEvt = (
    row: TurnActionSlotRow,
    status: ActionOutcomeStatus,
    message: string,
    detail?: Record<string, unknown>,
  ) => {
    events.push({
      civId: row.civ_id,
      civName: civNameOf(row.civ_id),
      slotIndex: row.slot_index,
      actionType: row.action_type,
      status,
      message,
      detail,
    })
  }

  const executeTrade = (row: TurnActionSlotRow, payload: Record<string, unknown>): void => {
    const receiverId = typeof payload.toCivId === 'string' ? payload.toCivId.trim() : ''
    const recv = receiverId ? snap.get(receiverId) : undefined

    const food = coerceNum(payload.food) ?? 0
    const timber = coerceNum(payload.timber) ?? 0
    const gold = coerceNum(payload.gold) ?? 0
    const stone = coerceNum(payload.stone) ?? 0

    if (!receiverId || !recv) {
      pushEvt(row, 'failed', 'Gift needs another civilisation to receive caravan goods', { receiverId })
      return
    }
    if (receiverId === row.civ_id) {
      pushEvt(row, 'failed', 'You cannot freight supplies to yourselves')
      return
    }
    if (!food && !timber && !gold && !stone) {
      pushEvt(row, 'failed', 'Specify at least one resource to trade')
      return
    }

    const sender = snap.get(row.civ_id)
    if (!sender) return

    if (sender.resources.food < food || sender.resources.timber < timber || sender.resources.gold < gold || sender.resources.stone < stone) {
      pushEvt(row, 'failed', 'Insufficient stockpiles for this gift transport')
      return
    }

    sender.resources = {
      ...sender.resources,
      food: sender.resources.food - food,
      timber: sender.resources.timber - timber,
      gold: sender.resources.gold - gold,
      stone: sender.resources.stone - stone,
    }
    recv.resources = {
      ...recv.resources,
      food: recv.resources.food + food,
      timber: recv.resources.timber + timber,
      gold: recv.resources.gold + gold,
      stone: recv.resources.stone + stone,
    }
    pushEvt(row, 'ok', `Transferred goods to ${recv.group_name}`, { receiverId })
  }

  const executePolicy = (row: TurnActionSlotRow, payload: Record<string, unknown>, subject: MutableSnapshot): void => {
    const policyIdRaw = typeof payload.policyId === 'string' ? payload.policyId.trim() : ''
    if (!policyIdRaw) {
      pushEvt(row, 'failed', 'Policy id missing')
      return
    }
    if (!(ADOPTABLE_POLICY_IDS as readonly string[]).includes(policyIdRaw)) {
      pushEvt(row, 'failed', 'Unknown civic policy codex entry')
      return
    }

    if (subject.policies.has(policyIdRaw)) {
      pushEvt(row, 'failed', `${policyIdRaw} is already enacted`)
      return
    }

    subject.policies.add(policyIdRaw)
    pushEvt(row, 'ok', `Adopted ${policyIdRaw}`, { policyIdRaw })
  }

  const executeResearch = (row: TurnActionSlotRow, payload: Record<string, unknown>, subject: MutableSnapshot): void => {
    const techId = typeof payload.techId === 'string' ? payload.techId.trim() : ''
    if (!techId) {
      pushEvt(row, 'failed', 'Missing technology identifier')
      return
    }

    const def = getTechDefinition(techId)
    if (!def) {
      pushEvt(row, 'failed', 'That invention is carved on no syllabus stone')
      return
    }

    if (subject.techs.has(techId)) {
      pushEvt(row, 'failed', 'Scholars already mastered this doctrine')
      return
    }

    const gateTurn = eraOpensOnTurn(def)

    if (args.turnNumberBeingResolved < gateTurn) {
      pushEvt(
        row,
        'failed',
        `${def.displayName} belongs to Century ${gateTurn}+ — the chronometer has not yet reached that symposium.`,
        { techId },
      )
      return
    }

    if (!prerequisitesMet(subject.techs, def)) {
      pushEvt(row, 'failed', `Master all prerequisite doctrines before unveiling «${def.displayName}».`, {
        techId,
      })
      return
    }

    const cost = def.knowledgeCost

    if (subject.resources.knowledge < cost) {
      pushEvt(row, 'failed', `Need ${cost} knowledge (have ${subject.resources.knowledge})`, { techId })
      return
    }

    subject.resources = { ...subject.resources, knowledge: subject.resources.knowledge - cost }
    subject.techs.add(techId)
    pushEvt(row, 'ok', `Unlocked «${def.displayName}»`, { techId })
  }

  const executeBuild = (row: TurnActionSlotRow, payload: Record<string, unknown>, subject: MutableSnapshot): void => {
    const q = coerceNum(payload.q)
    const r = coerceNum(payload.r)
    const buildingIdRaw = typeof payload.buildingId === 'string' ? payload.buildingId.trim() : ''
    if (q == null || r == null || !buildingIdRaw) {
      pushEvt(row, 'failed', 'BUILD needs map coordinates plus a blueprint id')
      return
    }

    const cell = getCellAt(map, q, r)
    if (!cell || cell.owner !== row.civ_id) {
      pushEvt(row, 'failed', 'You may only build upon settled soil')
      return
    }

    const spec = BUILDING_DEFS[buildingIdRaw]
    if (!spec) {
      pushEvt(row, 'failed', `Unknown structure «${buildingIdRaw}»`)
      return
    }

    if (!civilizationMayBuild(subject.techs, buildingIdRaw)) {
      pushEvt(row, 'failed', 'Grand Wonders demand Architecture mastery before stonemasons will attempt them')
      return
    }

    const goldNeeded = spec.goldCost ?? 0
    const stoneNeeded = spec.stoneCost ?? 0

    if (subject.resources.gold < goldNeeded || subject.resources.stone < stoneNeeded) {
      pushEvt(row, 'failed', 'Treasury quarries lacked resources for stonework')
      return
    }

    subject.resources = {
      ...subject.resources,
      gold: subject.resources.gold - goldNeeded,
      stone: subject.resources.stone - stoneNeeded,
    }

    subject.buildings.push({ q, r, buildingId: buildingIdRaw })
    pushEvt(row, 'ok', `${spec.displayName} raised at (${q},${r})`)
  }

  const executeExplore = (row: TurnActionSlotRow, payload: Record<string, unknown>, voyager: MutableSnapshot): void => {
    if (!civilizationHasTechAction(voyager.techs, 'EXPLORE')) {
      pushEvt(row, 'failed', 'Coastal pilots refuse the voyage until Sailing doctrines are inscribed')
      return
    }

    const q = coerceNum(payload.q)
    const r = coerceNum(payload.r)
    if (q == null || r == null) {
      pushEvt(row, 'failed', 'EXPLORE needs chart coordinates from the atlas')
      return
    }

    const cell = getCellAt(map, q, r)
    if (!cell) {
      pushEvt(row, 'failed', 'That bearing lies beyond the rim')
      return
    }

    if (!canScoutFromFrontier(map, row.civ_id, q, r)) {
      pushEvt(row, 'failed', 'Fleet cannot hoist sail — chart no contiguous fog from holdings', { q, r })
      return
    }

    cell.explored_by = cell.explored_by.includes(row.civ_id)
      ? cell.explored_by
      : [...cell.explored_by, row.civ_id]
    pushEvt(row, 'ok', `Fleet sounded the fog at (${q},${r})`, { q, r })
  }

  const executeExpand = (row: TurnActionSlotRow, payload: Record<string, unknown>): void => {
    const mover = snap.get(row.civ_id)
    if (!mover) return

    const q = coerceNum(payload.q)
    const r = coerceNum(payload.r)
    if (q == null || r == null) {
      pushEvt(row, 'failed', 'EXPAND needs frontier coordinates')
      return
    }

    const subjectPop = Math.floor(mover.resources.population)
    if (subjectPop < settings.expandPopulationThreshold) {
      pushEvt(row, 'failed', `Populace (${subjectPop}) below migration threshold (${settings.expandPopulationThreshold})`)
      return
    }

    const cell = getCellAt(map, q, r)
    if (!cell) {
      pushEvt(row, 'failed', 'That tile lies beyond the known world rim')
      return
    }

    if (cell.owner) {
      pushEvt(row, 'failed', 'That soil is claimed already')
      return
    }

    if (cell.terrain === 'mountain' || cell.terrain === 'lake') {
      pushEvt(row, 'failed', 'Your settlers refuse these barren climbs or deep waters')
      return
    }

    const borders = ownedTilesCount(map, row.civ_id) > 0
      ? isAdjacentToCivOwnership(map, row.civ_id, q, r)
      : true

    if (!borders) {
      pushEvt(row, 'failed', 'Expansion must adjoin your existing realm until a capital exists')
      return
    }

    cell.owner = row.civ_id
    revealAround(map, row.civ_id, q, r)
    pushEvt(row, 'ok', `Settlers founded new tile (${q},${r})`)
  }

  const executeAttack = (row: TurnActionSlotRow, payload: Record<string, unknown>, attackerSnap: MutableSnapshot): void => {
    const q = coerceNum(payload.q)
    const r = coerceNum(payload.r)
    if (q == null || r == null) {
      pushEvt(row, 'failed', 'Strike orders need coordinates')
      return
    }

    const cell = getCellAt(map, q, r)
    if (!cell?.owner || cell.owner === row.civ_id) {
      pushEvt(row, 'failed', 'Armies march only toward rival banners')
      return
    }

    if (!isAdjacentToCivOwnership(map, row.civ_id, q, r)) {
      pushEvt(row, 'failed', 'Front lines halted — target is not adjoining your holdings')
      return
    }

    const defenderSnap = snap.get(cell.owner)
    if (!defenderSnap) {
      pushEvt(row, 'failed', 'Defender regiment records missing — battle cancelled')
      return
    }

    const outcome = resolveCombatDiceBattle({
      gameId: args.gameId,
      turnNumber: args.turnNumberBeingResolved,
      slotRowId: row.id,
      attackerCivId: row.civ_id,
      defenderCivId: defenderSnap.id,
      attackerName: attackerSnap.group_name,
      defenderName: defenderSnap.group_name,
      q,
      r,
      defenderTerrain: cell.terrain,
      attackerMilitaryBase: attackerSnap.resources.military,
      defenderMilitaryBase: defenderSnap.resources.military,
      map,
      attackerSnapPop: attackerSnap.resources.population,
      defenderSnapPop: defenderSnap.resources.population,
    })

    combatLog.push(outcome.entry)

    attackerSnap.resources = {
      ...attackerSnap.resources,
      military: outcome.attackerMilAfterLoss,
      population: outcome.attackerPopAfterLoss,
    }
    defenderSnap.resources = {
      ...defenderSnap.resources,
      military: outcome.defenderMilAfterLoss,
      population: outcome.defenderPopAfterLoss,
    }

    if (outcome.attackerWinsHex) {
      cell.owner = row.civ_id
      revealAround(map, row.civ_id, q, r)
      pushEvt(row, 'ok', outcome.entry.narrative, { combat: outcome.entry })
      return
    }

    pushEvt(row, 'failed', outcome.entry.narrative, { combat: outcome.entry })
  }

  for (const row of sortedSlots) {
    const type = row.action_type as QueueActionType
    const payload = effectiveQueuedPayload(row)
    const active = snap.get(row.civ_id)

    switch (type) {
      case 'TRADE':
        executeTrade(row, payload)
        break
      default:
        if (!active) {
          pushEvt(row, 'skipped', 'Civilisation record missing mid-chronicle')
          continue
        }
        switch (type) {
          case 'BUILD':
            executeBuild(row, payload, active)
            break
          case 'RESEARCH':
            executeResearch(row, payload, active)
            break
          case 'EXPLORE':
            executeExplore(row, payload, active)
            break
          case 'EXPAND':
            executeExpand(row, payload)
            break
          case 'ATTACK':
            executeAttack(row, payload, active)
            break
          case 'ENACT_POLICY':
            executePolicy(row, payload, active)
            break
          default:
            pushEvt(row, 'skipped', `Unsupported decree «${String(type)}» queued`)
        }
    }
  }

  const civilizationPatches: Record<string, Record<string, unknown>> = {}

  for (const civRow of args.civilizationRows) {
    const s = snap.get(civRow.id)
    if (!s) continue

    const patched: Civilization = {
      ...civRow,
      resources: serializeCivResources(s.resources),
      techs: Array.from(s.techs),
      policies: Array.from(s.policies),
    }

    const ownedCells = map.cells.filter((cell) => cell.owner === civRow.id)
    const afterTick = calculateStatsForTurn(patched, settings, ownedCells, { freezeMilitary: true })

    civilizationPatches[civRow.id] = {
      resources: serializeCivResources(afterTick),
      techs: Array.from(s.techs),
      policies: Array.from(s.policies),
      buildings: s.buildings,
      action_points: maxActionPointsForCiv(settings, Array.from(s.techs), Array.from(s.policies)),
    }
  }

  const turnEventsJson = sortedSlots.map((r) => ({
    slot_id: r.id,
    civ_id: r.civ_id,
    turn_number: args.turnNumberBeingResolved,
    review_status: r.review_status,
    outcomes: events.filter((e) => e.civId === r.civ_id && e.slotIndex === r.slot_index),
  }))

  return { map, civilizationPatches, events, turnEventsJson, combatLog }
}