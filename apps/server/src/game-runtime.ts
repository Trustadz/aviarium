import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import type { PoolClient } from 'pg'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardBoardKey, LeaderboardRecord } from '../../../packages/game-sdk/src/leaderboards.js'
import type { PackDocument, PackEntry, PackRevision, ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import type { AttemptMutation, GameAttempt } from '../../../packages/game-sdk/src/progress.js'

export interface LevelRecord extends GameLevel {
  grid?: string | null
  difficulty?: string | null
  content?: unknown
}

export interface GamePacks {
  readManifest(input: unknown): PackDocument
  readDraft(input: unknown): PackDocument
  verify(input: PackDocument, prior: readonly LevelRecord[]): PackDocument | Promise<PackDocument>
  levels(pack: PackRevision): LevelRecord[]
  sameLevel(entry: PackEntry, rules: ProgressionRules, previous: PackEntry, previousRules: ProgressionRules): boolean
  builtIn: readonly { id: string; revision: number; coverFile?: string; data: PackDocument }[]
}

export interface GameLeaderboards {
  quickBoards: readonly { key: string; kind: 'quick'; meta: Record<string, string | number> }[]
  boardKey(level: LevelRecord): LeaderboardBoardKey
  parseBoard(key: string): LeaderboardBoardKey | undefined
  record(level: LevelRecord, save: GameAttempt, packTitle?: string): LeaderboardRecord
}

export interface ServerGame {
  id: string
  packs: GamePacks
  leaderboards?: GameLeaderboards
  preferences?: z.ZodObject
  routes?(app: FastifyInstance): void
  readMutation(input: unknown): AttemptMutation
  resolveGeneratedLevel?(db: PoolClient, mutation: AttemptMutation): Promise<LevelRecord | undefined>
  validateAttempt(attempt: GameAttempt, level: LevelRecord, rules?: ProgressionRules): void
}
