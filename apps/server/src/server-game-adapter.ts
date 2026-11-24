import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { GameRuleError, type GameDefinition, type GameResult, type StoredLevel } from '../../../packages/game-sdk/src/game.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardBoardKey, LeaderboardRecord } from '../../../packages/game-sdk/src/leaderboards.js'
import type { PackDocument, PackRevision, ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import { challengeMutationField, mutationIdentity, mutationStatus, type AttemptMutation, type GameAttempt } from '../../../packages/game-sdk/src/progress.js'
import { HttpError } from './auth.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'

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

function generatedId(definition: GameDefinition, seed: string) {
  return ('generated-' + definition.id + '-' + createHash('sha256').update(seed).digest('hex').slice(0, 12)).slice(0, 64)
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
          : entry.ruleset === previous.ruleset,
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
      const content = await generation.generate(seed, options)
      if (!content) return
      const level: GameLevel = generation.materialize
        ? await generation.materialize(seed, options, content)
        : {
            id: generatedId(definition, seed), revision: 1, ruleset: content.ruleset, title: content.title,
            source: 'Generated', seed, generatorVersion: content.generatorVersion,
            ...(content.grid ? { grid: content.grid } : {}),
            ...(content.content !== undefined ? { content: content.content } : {}),
            ...(content.difficulty ? { difficulty: content.difficulty } : {}),
          } as GameLevel
      if (level.id !== mutation.data.level) return
      await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,seed,
          generator_version,validation,catalog_visible,game_id,content)
        VALUES($1,$2,$3,$4,$5,$6,'Generated',$7,$8,'unique',false,$9,$10)
        ON CONFLICT (id,revision) DO NOTHING`,
      [level.id, level.revision, level.ruleset, level.title,
        (level as StoredLevel).grid ?? null, (level as StoredLevel).difficulty ?? null,
        (level as StoredLevel).seed ?? seed, (level as StoredLevel).generatorVersion ?? content.generatorVersion,
        definition.id, (level as StoredLevel).content === undefined ? null : JSON.stringify((level as StoredLevel).content)])
      return level as LevelRecord
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
