import type { GameLevel } from './index.js'

/** A player may post one visible result per exact starting puzzle inside this window. */
export const leaderboardCooldownDays = 30
export const leaderboardTopLimit = 20
export const leaderboardResultStatuses = ['active', 'cooldown', 'removed'] as const
export type LeaderboardResultStatus = typeof leaderboardResultStatuses[number]

/**
 * Quick Play boards group different grids by their settings (Sudoku difficulty,
 * Nonograms size and difficulty). Level boards group one published level
 * revision. The exact grid is stored separately for the per-puzzle cooldown
 * and for the "play this board" action on a result row.
 */
export type LeaderboardBoardKind = 'quick' | 'level'
export type LeaderboardValueUnit = 'ms'

export interface LeaderboardBoardKey {
  key: string
  kind: LeaderboardBoardKind
  meta: Record<string, string | number>
  levelId?: string
  levelRevision?: number
}

/** The game-owned interpretation of one completed attempt. */
export interface LeaderboardRecord {
  boardKey: string
  boardKind: LeaderboardBoardKind
  boardMeta: Record<string, string | number>
  /** Identifies the exact starting puzzle for the cooldown, independent of level or seed ID. */
  puzzleContent: string
  value: number
  unit: LeaderboardValueUnit
  lowerIsBetter: boolean
  levelTitle: string
  packTitle?: string
  seedCode?: string
  aids?: unknown
  rulesVersion: number
}

export interface LeaderboardBoardInfo {
  game: string
  key: string
  kind: LeaderboardBoardKind
  difficulty?: string
  size?: number
  levelTitle?: string
  packTitle?: string
  levelId?: string
  levelRevision?: number
}

export interface LeaderboardStanding {
  rank: number
  name: string
  value: number
  unit: LeaderboardValueUnit
  completedAt: string
  /** When the result became visible on the board. */
  recordedAt: string
  you: boolean
  /** Only populated for the top three and the viewer's own row. */
  avatarUrl?: string | null
  /** The exact starting level, so another player can open the same board. */
  level?: GameLevel
  seedCode?: string | null
  aids?: unknown
}

export interface LeaderboardPlayerResult {
  game: string
  board: LeaderboardBoardInfo
  rank: number
  total: number
  value: number
  unit: LeaderboardValueUnit
  completedAt: string
  recordedAt: string
}

export interface LeaderboardPlayerSummary {
  lastPosted: LeaderboardPlayerResult | null
  bestRank: LeaderboardPlayerResult | null
  /** Active result rows in scope. */
  posted: number
  /** Distinct active boards in scope. */
  boards: number
}

export interface LeaderboardCooldown {
  board: LeaderboardBoardInfo
  value: number
  unit: LeaderboardValueUnit
  completedAt: string
  recordedAt: string
  /** When a new result on this exact puzzle can become visible again. */
  visibleAt: string
}

export interface LeaderboardSummary {
  board: LeaderboardBoardInfo
  top: LeaderboardStanding[]
  you: LeaderboardStanding | null
  total: number
}

export interface LeaderboardRemovalNotice {
  id: string
  value: number
  unit: LeaderboardValueUnit
  board: LeaderboardBoardInfo
  seedCode?: string | null
  adminName: string
  reason: string
  removedAt: string
}

export const emptyLeaderboardSummary = (board: LeaderboardBoardInfo): LeaderboardSummary =>
  ({ board, top: [], you: null, total: 0 })

export const emptyLeaderboardPlayerSummary = (): LeaderboardPlayerSummary =>
  ({ lastPosted: null, bestRank: null, posted: 0, boards: 0 })

export function formatLeaderboardValue(value: number, unit: LeaderboardValueUnit) {
  if (unit === 'ms') {
    const seconds = Math.floor(Math.max(0, value) / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  return String(value)
}

export function withinLeaderboardCooldown(recordedAt: number | Date, now = Date.now()) {
  const time = typeof recordedAt === 'number' ? recordedAt : recordedAt.getTime()
  return now - time < leaderboardCooldownDays * 86_400_000
}
