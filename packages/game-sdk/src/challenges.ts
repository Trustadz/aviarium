import type { GameLevel } from './index.js'
import type { LeaderboardStanding, LeaderboardValueUnit } from './leaderboards.js'

/** One kind of challenge. Only `daily` ships now; the others are future kinds. */
export type ChallengeKind = 'daily' | 'weekly' | 'monthly' | 'seasonal' | 'one_time'

/** A slot is playable only when its level has been generated. */
export type ChallengeSlotStatus = 'pending' | 'ready' | 'failed'

/**
 * Server-derived state for the signed-in player on one slot. The client must
 * not infer this from timestamps; the server owns the boundary and the
 * one-attempt rule.
 */
export type ChallengePlayerStatus = 'available' | 'started' | 'completed' | 'closed' | 'expired' | 'missed' | 'unavailable'

/** A challenge-level value is always JSON-serializable. */
export type ChallengeOptionValue = string | number | boolean | null

/** One admin-enableable value in an option group. */
export interface ChallengeOptionChoice {
  /** Stable id persisted in the series settings and slot, e.g. `easy`. */
  id: string
  /** Message key or English label for the admin/player UI. */
  label: string
  value: ChallengeOptionValue
}

/**
 * Puzzle settings and challenge-applicable pack rules share this shape. The
 * default build only enables puzzle settings (difficulty/size); pack-rule
 * groups can join later without changing the scheduler.
 */
export interface ChallengeOptionGroup {
  key: string
  label: string
  kind: 'generation' | 'rule'
  choices: readonly ChallengeOptionChoice[]
  /** Choice ids enabled on a fresh series. */
  defaultEnabled: readonly string[]
}

/** One admin-configured candidate for a daily game slot. */
export interface ChallengeGameSelection {
  /** Game id. The same game may appear in multiple selections. */
  game: string
  /** Option-group key -> enabled choice ids for this candidate. */
  options: Record<string, string[]>
}

/** The deterministic selection for one slot. */
export interface ChallengeSelection {
  /** Option-group key -> chosen choice id. */
  groups: Readonly<Record<string, string>>
  /** Resolved generated-level values (difficulty, size, ...). */
  options: Readonly<Record<string, ChallengeOptionValue>>
  /** Resolved gameplay rules (defaults for now; future pack-rule groups). */
  rules: Readonly<Record<string, ChallengeOptionValue>>
}

/** Everything needed to reproduce one slot's level. Serializable. */
export interface ChallengeSlotRecipe {
  seriesId: string
  occurrenceId: string
  periodKey: string
  game: string
  seed: string
  selection: ChallengeSelection
}

/** The generated content; the orchestrator assigns level id/revision/source. */
export interface ChallengeGeneratedLevel {
  ruleset: number
  title: string
  difficulty?: string | null
  grid?: string
  content?: unknown
  /** Default gameplay rules for this level; also used by a later replay. */
  rules: Readonly<Record<string, ChallengeOptionValue>>
  generatorVersion: number
}

/** The game's interpretation of a completed, already-validated attempt. */
export interface ChallengeResult {
  value: number
  unit: LeaderboardValueUnit
  lowerIsBetter: boolean
  aids?: unknown
  rulesVersion: number
  /** Identifies the exact starting puzzle for audit; never used for a cooldown. */
  puzzleContent: string
}

/**
 * The game's declaration of challenge support. The platform owns scheduling,
 * attempts, boards and history; the game generates the exact level and
 * interprets a completed attempt. Validation reuses the game's normal attempt
 * validation.
 */
export interface ChallengeGameDefinition<Level extends GameLevel = GameLevel, Save = unknown> {
  /** Message key or English label for the admin/discovery UI. */
  label: string
  optionGroups: readonly ChallengeOptionGroup[]
  /** Deterministic and pure: same recipe => same level. */
  generate(recipe: ChallengeSlotRecipe): Promise<ChallengeGeneratedLevel>
  /** Optional pre-persist check (unique solution, solvable, ...). */
  verify?(generated: ChallengeGeneratedLevel): Promise<void>
  record(level: Level, attempt: Save, rules: Readonly<Record<string, ChallengeOptionValue>>): ChallengeResult
}

/** A past challenge can be replayed as a normal generated game via this recipe. */
export interface ChallengeReplay {
  game: string
  seed: string
  options: Readonly<Record<string, ChallengeOptionValue>>
  rules: Readonly<Record<string, ChallengeOptionValue>>
  generatorVersion: number
}

export interface ChallengeSeriesView {
  id: string
  kind: ChallengeKind
  enabled: boolean
  gameLimit: number
  eligibleGames: string[] | null
  gameOptions: Record<string, Record<string, string[]>>
  gameSelections: ChallengeGameSelection[]
  timezone: string
  resetMinute: number
  generationVersion: number
  updatedAt: string
}

export interface ChallengeOccurrenceView {
  id: string
  periodKey: string
  startsAt: string
  endsAt: string
  timezone: string
  prepared: boolean
  preparing: boolean
  failureCode?: string | null
}

export interface ChallengePlayerResult {
  id: string
  status: 'active' | 'removed'
  rank: number | null
  total: number
  value: number
  unit: LeaderboardValueUnit
}

export interface ChallengePlayerSlot {
  status: ChallengePlayerStatus
  attemptId?: string
  sessionId?: string
  startedAt?: string
  result?: ChallengePlayerResult | null
}

export interface ChallengeStandings {
  top: LeaderboardStanding[]
  you: LeaderboardStanding | null
  total: number
}

export interface ChallengeLevelView extends GameLevel {
  grid?: string | null
  content?: unknown
  difficulty?: string | null
}

export interface ChallengeSlotView {
  id: string
  game: string
  position: number
  status: ChallengeSlotStatus
  options: Readonly<Record<string, ChallengeOptionValue>>
  rules: Readonly<Record<string, ChallengeOptionValue>>
  level?: ChallengeLevelView
  player: ChallengePlayerSlot
  standings: ChallengeStandings
  replay?: ChallengeReplay
  failureCode?: string | null
}

export interface ChallengeDayView {
  occurrence: ChallengeOccurrenceView | null
  slots: ChallengeSlotView[]
  open: number
  serverNow: string
  nextStart?: string | null
}

export const emptyChallengeStandings = (): ChallengeStandings => ({ top: [], you: null, total: 0 })
