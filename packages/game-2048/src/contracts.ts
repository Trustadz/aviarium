import { z } from 'zod'
import type { GameLevel } from '../../game-sdk/src/index.js'
import {
  definePackSchemas, packLevelFields, progressionRules, type PackDocument,
} from '../../game-sdk/src/packs.js'
import {
  attemptIdentity, attemptOutcome, packRevisionField,
} from '../../game-sdk/src/progress.js'
import { GameRuleError } from '../../game-sdk/src/game.js'
import { applyMove, boardSize, cellCount, maxTile, noMoves, startBoard } from './rules.js'
import { createRandom, seedHash, twenty48GeneratorVersion } from './random.js'

export const twenty48Id = '2048'
export const twenty48RulesVersion = 1
export const twenty48SaveFormat = 1
export const quickPlayVersion = twenty48GeneratorVersion

export const seedSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._~-]+$/)
export const boardSchema = z.array(z.number().int().min(0).max(1_000_000_000)).length(cellCount)
  .refine(board => board.every(value => value === 0 || (value >= 2 && Number.isInteger(Math.log2(value)))),
    'Tile values must be zero or a power of two')

export const twenty48SaveSchema = z.object({
  ...attemptIdentity,
  ...attemptOutcome,
  packRevision: packRevisionField,
  game: z.literal(twenty48Id),
  ruleset: z.literal(twenty48RulesVersion),
  format: z.literal(twenty48SaveFormat),
  board: boardSchema,
  score: z.number().int().min(0).max(1_000_000_000),
  /** One entry per counted move. 0 up, 1 right, 2 down, 3 left. */
  moves: z.array(z.number().int().min(0).max(3)).max(50_000),
  /** Elapsed milliseconds when the first 2048 tile appeared. */
  reached2048At: z.number().int().min(0).max(365 * 86_400_000).optional(),
})
export type Twenty48Save = z.infer<typeof twenty48SaveSchema>

export const quickDescriptor = z.object({
  seed: seedSchema,
  version: z.literal(quickPlayVersion),
})
export type QuickDescriptor = z.infer<typeof quickDescriptor>

const entry = z.object({
  ...packLevelFields,
  ruleset: z.literal(twenty48RulesVersion),
  content: z.object({ start: boardSchema, size: z.literal(boardSize) }),
})
export type Twenty48Entry = z.infer<typeof entry>

export const twenty48Packs = definePackSchemas(twenty48Id, z.literal('classic'),
  progressionRules, entry, entry)

export interface Twenty48Level extends GameLevel {
  content: { start: number[]; size: 4 }
  difficulty?: 'Classic'
}

export function twenty48LevelId(seed: string, version = quickPlayVersion) {
  return '2048-quick-' + seedHash(seed, version)
}

/** A generated level. Synchronous so the menu can preview and launch offline. */
export function quickTwenty48(seed: string, version = quickPlayVersion): Twenty48Level {
  const start = startBoard(seed, version)
  return {
    game: twenty48Id,
    id: twenty48LevelId(seed, version),
    revision: 1,
    ruleset: twenty48RulesVersion,
    title: 'Classic',
    source: 'Generated',
    seed,
    generatorVersion: version,
    difficulty: 'Classic',
    content: { start, size: boardSize },
  }
}

export function createTwenty48Attempt(level: Twenty48Level): Twenty48Save {
  return {
    game: twenty48Id,
    level: level.id,
    levelRevision: level.revision,
    ruleset: twenty48RulesVersion,
    format: twenty48SaveFormat,
    elapsedMs: 0,
    completed: false,
    board: [...level.content.start],
    score: 0,
    moves: [],
  }
}

export function formatTwenty48SeedCode(seed: string, version = quickPlayVersion) {
  return '2048-V' + version + '-' + seed
}

/** Accept either a bare seed or the copyable seed code. */
export function parseTwenty48SeedCode(input: string): { seed: string; version: number } | undefined {
  const value = input.trim()
  const prefixed = /^2048-V(\d+)-(.+)$/.exec(value)
  if (prefixed) {
    const version = Number(prefixed[1])
    const seed = prefixed[2] ?? ''
    return seedSchema.safeParse(seed).success && version === quickPlayVersion ? { seed, version } : undefined
  }
  return seedSchema.safeParse(value).success ? { seed: value, version: quickPlayVersion } : undefined
}

export interface Replay {
  board: number[]
  score: number
  reached2048: boolean
  maxTile: number
}

/** Replay the counted moves from the seed. This is the server's source of truth. */
export function replayTwenty48(level: Twenty48Level, moves: readonly number[]): Replay {
  const seed = level.seed
  const version = level.generatorVersion ?? quickPlayVersion
  if (!seed) throw new GameRuleError('twenty48_seed_missing')
  const random = createRandom(seed, version)
  let board = [...level.content.start]
  let score = 0
  let reached2048 = false
  for (const move of moves) {
    if (![0, 1, 2, 3].includes(move)) throw new GameRuleError('twenty48_move_invalid')
    const result = applyMove(board, move as 0 | 1 | 2 | 3, random)
    board = [...result.board]
    score += result.gain
    if (result.reached2048) reached2048 = true
  }
  return { board, score, reached2048, maxTile: maxTile(board) }
}

export function validateTwenty48Attempt(input: unknown, level: Twenty48Level) {
  const save = twenty48SaveSchema.parse(input)
  if (!level.seed || level.content.size !== boardSize) throw new GameRuleError('twenty48_level_invalid')
  const version = level.generatorVersion ?? quickPlayVersion
  if (JSON.stringify(startBoard(level.seed, version)) !== JSON.stringify(level.content.start))
    throw new GameRuleError('twenty48_level_invalid')
  const replay = replayTwenty48(level, save.moves)
  if (JSON.stringify(replay.board) !== JSON.stringify(save.board))
    throw new GameRuleError('twenty48_board_invalid')
  if (replay.score !== save.score) throw new GameRuleError('twenty48_score_invalid')
  if (replay.reached2048 !== (save.reached2048At !== undefined))
    throw new GameRuleError('twenty48_goal_invalid')
  if (save.reached2048At !== undefined && save.reached2048At > save.elapsedMs)
    throw new GameRuleError('twenty48_goal_invalid')
  if (save.completed && !noMoves(replay.board)) throw new GameRuleError('twenty48_not_finished')
}

export function twenty48PackLevel(entry: Twenty48Entry, pack: { id: string; revision: number; builtIn: boolean },
  stop: number): Twenty48Level {
  return {
    game: twenty48Id,
    id: entry.levelId ?? ('pack:' + pack.id + ':' + stop),
    revision: entry.levelRevision ?? pack.revision,
    ruleset: entry.ruleset,
    title: entry.title,
    source: pack.builtIn ? 'Built-in' : 'Creator',
    content: entry.content,
    pack: { id: pack.id, revision: pack.revision, stop },
  }
}

export const twenty48PackDocument = twenty48Packs.published as unknown as z.ZodType<PackDocument>
