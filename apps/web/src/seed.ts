import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { GameOptionField } from '../../../packages/game-sdk/src/game.js'
import { formatSeedCode, parseSeedCode, type SeedBoard, type SeedError,
  type SeedOptions, type SeedPayload } from '../../../packages/game-sdk/src/seed-code.js'
import { gameDefinition } from './game-definitions.js'
import type { WebGame } from './game-web.js'
import type { Translate } from './i18n.js'
import type { ProfilePreferences } from './storage.js'

export type ParsedSeed = { ok: true; value: SeedPayload } | { ok: false; error: SeedError }

export function seedOptions(game: WebGame, preferences: ProfilePreferences): SeedOptions {
  return Object.fromEntries((game.playOptions ?? []).map(option =>
    [option.key, Boolean(preferences[option.key] ?? option.default)]))
}

/** Build a share payload from a generated level, or `undefined` for authored levels. */
export function seedPayload(game: WebGame, level: GameLevel, preferences: ProfilePreferences): SeedPayload | undefined {
  const definition = gameDefinition(game.id)
  const generation = definition?.generation
  if (!generation) return undefined
  let described: { quickPlay?: Record<string, unknown> } | undefined
  try {
    described = generation.describe?.(level as never) as { quickPlay?: Record<string, unknown> } | undefined
  } catch {
    return undefined
  }
  const quickPlay = described?.quickPlay
  if (!quickPlay || typeof quickPlay.seed !== 'string' || typeof quickPlay.version !== 'number') return undefined
  const board = Object.fromEntries(Object.entries(quickPlay)
    .filter(([key]) => key !== 'seed' && key !== 'version')) as SeedBoard
  return { game: game.id, version: quickPlay.version, seed: quickPlay.seed, board, options: seedOptions(game, preferences) }
}

export function seedCode(game: WebGame, level: GameLevel, preferences: ProfilePreferences) {
  const payload = seedPayload(game, level, preferences)
  return payload ? formatSeedCode(payload) : undefined
}

/** Parse and validate a code against the game's generator and board-option schema. */
export function parseSeed(game: WebGame, input: string): ParsedSeed {
  const definition = gameDefinition(game.id)
  if (!definition?.generation) return { ok: false, error: 'malformed' }
  const parsed = parseSeedCode(input, game.id, definition.generation.version)
  if (!parsed.ok) return parsed
  const board = definition.generation.options.schema.safeParse(parsed.value.board)
  if (!board.success) return { ok: false, error: 'invalid-options' }
  const options = Object.fromEntries((game.playOptions ?? []).map(option => {
    const value = parsed.value.options[option.key]
    return [option.key, typeof value === 'boolean' ? value : option.default]
  }))
  return { ok: true, value: { ...parsed.value, board: board.data as SeedBoard, options } }
}

export function seedBoardFields(game: WebGame): readonly GameOptionField[] {
  return gameDefinition(game.id)?.generation?.options.fields ?? []
}

export function seedGenerationVersion(game: WebGame) {
  return gameDefinition(game.id)?.generation?.version
}

export function seedBoardLabel(game: WebGame, t: Translate, board: SeedBoard) {
  const detail = game.seed?.summary(t, board) ?? ''
  return detail ? game.title + ' · ' + detail : game.title
}

export function sameSeedBoard(left: SeedBoard, right: SeedBoard) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => left[key] === right[key])
}
