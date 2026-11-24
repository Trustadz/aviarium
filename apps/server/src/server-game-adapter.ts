import { z } from 'zod'
import type { PoolClient } from 'pg'
import { GameRuleError, type GameDefinition, type GameResult, type StoredLevel } from '../../../packages/game-sdk/src/game.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardBoardKey, LeaderboardRecord } from '../../../packages/game-sdk/src/leaderboards.js'
import type { PackDocument, PackRevision, ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import { challengeMutationField, mutationIdentity, mutationStatus, type AttemptMutation, type GameAttempt } from '../../../packages/game-sdk/src/progress.js'
import { HttpError } from './auth.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'
import { createGeneratedLevel } from './generated-level.js'

function defaultBoard(level: LevelRecord): LeaderboardBoardKey {
  return { key: 'level:' + level.id + ':' + level.revision, kind: 'level', meta: {},
    levelId: level.id, levelRevision: level.revision }
}

function defaultParseBoard(key: string): LeaderboardBoardKey | undefined {
  if (!key.startsWith('level:')) return undefined
  const rest = key.slice('level:'.length)
  const separator = rest.lastIndexOf(':')
  if (separator < 1) return undefined
  const levelId = rest.slice(0, separator)
  const levelRevision = Number(rest.slice(separator + 1))
  if (!/^[a-z0-9:-]{1,64}$/.test(levelId) || !Number.isInteger(levelRevision) || levelRevision < 1) return undefined
  return { key, kind: 'level', meta: {}, levelId, levelRevision }
}

/**
 * Transitional bridge from the new GameDefinition to the existing ServerGame
 * shape. It lets the registry become the source of truth before the remaining
 * platform modules drop the legacy interface.
 */
export function serverGameFromDefinition(
  definition: GameDefinition<any, any, any, any>,
  legacyRoutes?: ServerGame['routes'],
): ServerGame {
  const boardKey = (level: LevelRecord) =>
    definition.leaderboard?.board?.(level as GameLevel) ?? defaultBoard(level)
  const mutationSchema = z.object({
    ...mutationIdentity,
    data: definition.play.save.schema,
    ...mutationStatus,
    ...challengeMutationField,
    ...(definition.generation?.quickPlay ? { quickPlay: definition.generation.quickPlay.optional() } : {}),
  })

  return {
    id: definition.id,
    preferences: definition.preferences,
    packs: {
      readManifest: input => definition.packs.schemas.manifest.parse(input),
      readDraft: input => definition.packs.schemas.draft.parse(input),
      async verify(input, prior) {
        try {
          return await definition.packs.verify(input, prior as readonly StoredLevel[])
        } catch (error) {
          if (error instanceof GameRuleError)
            throw new HttpError(422, error.code as never, error.values as never)
          throw error
        }
      },
      levels: pack => definition.packs.materialize(pack),
      sameLevel: (entry, rules, previous, previousRules) =>
        definition.packs.sameContent
          ? definition.packs.sameContent(entry, rules as never, previous, previousRules as never)
          : entry.ruleset === previous.ruleset && JSON.stringify(entry) === JSON.stringify(previous),
      builtIn: definition.packs.builtIn,
    },
    leaderboards: definition.leaderboard && {
      quickBoards: (definition.leaderboard.quickBoards ?? [])
        .filter(board => board.kind === 'quick') as unknown as readonly { key: string; kind: 'quick'; meta: Record<string, string | number> }[],
      boardKey,
      parseBoard: key => definition.leaderboard?.parseBoard?.(key) ?? defaultParseBoard(key),
      record: (level, save, packTitle) => {
        const result = definition.leaderboard!.result(level as never, save as never, definition.play.rules.defaults as never)
        const board = boardKey(level)
        return {
          ...result,
          boardKey: board.key,
          boardKind: board.kind,
          boardMeta: board.meta,
          levelTitle: level.title,
          packTitle,
        } as LeaderboardRecord
      },
    },
    readMutation: input => mutationSchema.parse(input) as AttemptMutation,
    async resolveGeneratedLevel(db: PoolClient, mutation: AttemptMutation) {
      const generation = definition.generation
      if (!generation?.quickPlay || mutation.data.levelRevision !== 1) return
      const parsed = generation.quickPlay.safeParse((mutation as AttemptMutation & { quickPlay?: unknown }).quickPlay)
      if (!parsed.success) return
      const descriptor = parsed.data as Record<string, unknown>
      const { seed, version: _version, ...optionInput } = descriptor
      if (typeof seed !== 'string') return
      const options = generation.options.schema.parse(optionInput)
      const level = await createGeneratedLevel(db, definition, seed, options)
      if (!level || level.id !== mutation.data.level) return
      return level
    },
    validateAttempt(input, level, rules) {
      try {
        definition.play.save.validate(input as never, level as never, {
          rules: (rules ?? definition.play.rules.defaults) as never,
        })
      } catch (error) {
        if (error instanceof GameRuleError) throw new HttpError(422, error.code as never, error.values as never)
        throw error
      }
    },
    routes: legacyRoutes ?? (() => undefined),
  }
}
