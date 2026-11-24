import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment } from './config.js'
import { createGeneratedLevel } from './generated-level.js'
import { gameRegistry } from './game-registry.js'
import type { LevelRecord } from './game-runtime.js'

const gameParam = z.string().regex(/^[a-z0-9-]{1,64}$/)
const levelId = z.string().regex(/^[a-z0-9-]{1,64}$/)

/**
 * Generic game endpoints: Quick Play generation and level fetch. The game
 * definition supplies the descriptor schema, generator and materializer; the
 * platform owns persistence, auth and the response.
 */
export function registerGameRoutes(app: FastifyInstance) {
  app.post('/api/games/:game/quick-play', async request => {
    const gameId = gameParam.parse((request.params as { game: string }).game)
    const registered = gameRegistry.get(gameId)
    const generation = registered?.definition.generation
    if (!registered || !generation?.quickPlay) throw new HttpError(404, 'not_found')
    if (loginEnabled || testEnvironment) await requireUser(request)
    const input = (generation.quickPlay as z.ZodObject<any>).partial({ seed: true, version: true })
      .parse(request.body) as Record<string, unknown>
    const descriptor = { ...input, seed: input.seed ?? randomBytes(8).toString('hex'),
      version: input.version ?? generation.version }
    const { seed, version: _version, ...optionInput } = descriptor
    if (typeof seed !== 'string') throw new HttpError(422, 'puzzle_revision_unavailable')
    const options = generation.options.schema.parse(optionInput)
    const level = await createGeneratedLevel(pool, registered.definition, seed, options)
    if (!level) throw new HttpError(500, 'server_error')
    return level
  })

  app.get('/api/games/:game/levels/:id/:revision', async request => {
    const { game, id, revision } = z.object({ game: gameParam, id: levelId,
      revision: z.coerce.number().int().positive() }).parse(request.params)
    if (!gameRegistry.get(game)) throw new HttpError(404, 'not_found')
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { rows: [level] } = await pool.query<LevelRecord>(`SELECT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,
      l.source,l.seed,l.generator_version AS "generatorVersion" FROM published_levels l
      WHERE l.id=$1 AND l.revision=$2 AND l.game_id=$3
        AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)`, [id, revision, game])
    if (!level) throw new HttpError(404, 'puzzle_revision_unavailable')
    return level
  })
}
