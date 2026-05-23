// ─── Turn action queue ───────────────────────────────────────────────────────

export type QueueActionType =
  | 'EXPAND'
  | 'EXPLORE'
  | 'ATTACK'
  | 'TRADE'
  | 'RESEARCH'
  | 'BUILD'
  | 'ENACT_POLICY'

export type QueueReviewStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'modified'

export interface ExpandPayload {
  q: number
  r: number
}

export interface ExplorePayload {
  q: number
  r: number
}

export interface AttackPayload {
  q: number
  r: number
}

export interface TradePayload {
  toCivId: string
  food?: number
  timber?: number
  gold?: number
  stone?: number
}

export interface ResearchPayload {
  techId: string
}

export interface BuildPayload {
  q: number
  r: number
  buildingId: string
}

export interface EnactPolicyPayload {
  policyId: string
}

export type ActionPayload =
  | ExpandPayload
  | ExplorePayload
  | AttackPayload
  | TradePayload
  | ResearchPayload
  | BuildPayload
  | EnactPolicyPayload

export interface TurnActionSlotRow {
  id: string
  game_id: string
  civ_id: string
  turn_number: number
  slot_index: number
  action_type: QueueActionType
  payload: Record<string, unknown>
  review_status: QueueReviewStatus
  reviewed_payload: Record<string, unknown> | null
  submitted_at: string
}
