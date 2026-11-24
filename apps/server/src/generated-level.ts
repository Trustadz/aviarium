import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { GameDefinition, StoredLevel } from '../../../packages/game-sdk/src/game.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LevelRecord } from './game-runtime.js'

type Db = Pool | PoolClient

function generatedId(definition: GameDefinition, seed: string) {
  return ('generated-' + definition.id + '-' + createHash('sha256').update(seed).digest('hex').slice(0, 12)).slice(0, 64)
}

/**
 * Generate and persist a Quick Play/generated level through a GameDefinition.
 * Shared by progress sync and the generic /api/games/:game/quick-play route.
 */
export async function createGeneratedLevel(
  db: Db, definition: GameDefinition<any, any, any, any>, seed: string, options: unknown,
): Promise<LevelRecord | undefined> {
  const generation = definition.generation
  if (!generation) return
  const content = await generation.generate(seed, options as never)
  if (!content) return
  if (generation.verify) await generation.verify(content, options as never)
  const level: GameLevel = generation.materialize
    ? await generation.materialize(seed, options as never, content)
    : {
        id: generatedId(definition, seed), revision: 1, ruleset: content.ruleset, title: content.title,
        source: 'Generated', seed, generatorVersion: content.generatorVersion,
        ...(content.grid ? { grid: content.grid } : {}),
        ...(content.content !== undefined ? { content: content.content } : {}),
        ...(content.difficulty ? { difficulty: content.difficulty } : {}),
      } as GameLevel
  await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,seed,
      generator_version,validation,catalog_visible,game_id,content)
    VALUES($1,$2,$3,$4,$5,$6,'Generated',$7,$8,'unique',false,$9,$10)
    ON CONFLICT (id,revision) DO NOTHING`,
  [level.id, level.revision, level.ruleset, level.title,
    (level as StoredLevel).grid ?? null, (level as StoredLevel).difficulty ?? null,
    (level as StoredLevel).seed ?? seed, (level as StoredLevel).generatorVersion ?? content.generatorVersion,
    definition.id, (level as StoredLevel).content === undefined ? null : JSON.stringify((level as StoredLevel).content)])
  return level as LevelRecord
}
