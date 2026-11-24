export interface GameMetadata {
  id: string
  title: string
  description: string
  tags: readonly string[]
  eReader: boolean
  input: readonly ('keyboard' | 'pointer' | 'touch')[]
}

export interface GameRules<Level, State, Move, Solution> {
  ruleset: number
  saveFormat: number
  create(level: Level): State
  apply(level: Level, state: State, move: Move): State
  verify(level: Level, candidate: Solution): boolean
}

export type Validation<Solution> =
  | { kind: 'invalid'; reason: string }
  | { kind: 'unsolvable' }
  | { kind: 'inconclusive'; solution?: Solution }
  | { kind: 'unique'; solution: Solution }
  | { kind: 'multiple'; solution: Solution }

export const difficulties = ['Easy', 'Medium', 'Hard', 'Extreme', 'Genius'] as const
export type Difficulty = typeof difficulties[number]
export interface GameLevel {
  game?: string
  id: string
  revision: number
  ruleset: number
  title: string
  source: 'Built-in' | 'Generated' | 'Creator' | 'Challenge'
  seed?: string | null
  generatorVersion?: number | null
  pack?: { id: string; revision: number; stop: number; legacyStandalone?: boolean }
}

export interface SaveEnvelope {
  game: string
  level: string
  levelRevision: number
  ruleset: number
  format: number
}

export { savedGameLimit } from './progress.js'
export {
  emptyLeaderboardPlayerSummary, emptyLeaderboardSummary, formatLeaderboardValue, leaderboardCooldownDays, leaderboardResultStatuses,
  leaderboardTopLimit, withinLeaderboardCooldown,
} from './leaderboards.js'
export type {
  LeaderboardBoardInfo, LeaderboardBoardKey, LeaderboardBoardKind, LeaderboardCooldown, LeaderboardPackStanding,
  LeaderboardPackSummary, LeaderboardPlayerResult, LeaderboardPlayerSummary, LeaderboardRecord, LeaderboardRemovalNotice, LeaderboardResultStatus, LeaderboardStanding,
  LeaderboardSummary, LeaderboardValueUnit,
} from './leaderboards.js'

export {
  GameRuleError, gameContractVersion, validateGameRegistry,
} from './game.js'
export type {
  GameDefinition, GameGeneration, GameLeaderboard, GameOptionField, GameOptionGroup, GamePacks, GamePlay,
  GameRegistry, GameResult, GameRuleValues, GeneratedContent, RegisteredGame, SaveContext, StoredLevel,
} from './game.js'
