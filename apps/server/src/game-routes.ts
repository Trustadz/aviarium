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
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
    const descriptor = { ...body, seed: body.seed ?? randomBytes(8).toString('hex'),
      version: body.version ?? generation.version }
    const parsed = generation.quickPlay.safeParse(descriptor)
    if (!parsed.success) throw new HttpError(422, 'puzzle_revision_unavailable')
    const { seed, version: _version, ...optionInput } = parsed.data as Record<string, unknown>
    if (typeof seed !== 'string') throw new HttpError(422, 'puzzle_revision_unavailable')
    const options = generation.options.schema.parse(optionInput)
    const level = await createGeneratedLevel(pool, registered.definition, seed, options)
    if (!level) throw new HttpError(500, 'server_error')
    return level
  })


  app.get('/api/games/:game/catalog', async request => {
    const game = gameParam.parse((request.params as { game: string }).game)
    if (!gameRegistry.get(game)) throw new HttpError(404, 'not_found')
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { rows } = await pool.query(`SELECT id,revision,ruleset,title,grid,content,pack,difficulty,source,seed,
        generator_version AS "generatorVersion"
      FROM (SELECT DISTINCT ON (id) * FROM published_levels WHERE game_id=$1 ORDER BY id,revision DESC) latest
      WHERE catalog_visible AND pack IS NULL
        AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=latest.id)
      ORDER BY published_at,id`, [game])
    return rows
  })

  app.get('/api/games/:game/levels/:id/:revision', async request => {
    const { game, id, revision } = z.object({ game: gameParam, id: levelId,
      revision: z.coerce.number().int().positive() }).parse(request.params)
    if (!gameRegistry.get(game)) throw new HttpError(404, 'not_found')
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { rows: [level] } = await pool.query<LevelRecord>(`SELECT l.id,l.revision,l.ruleset,l.title,l.grid,l.content,l.pack,l.difficulty,
      l.source,l.seed,l.generator_version AS "generatorVersion" FROM published_levels l
      WHERE l.id=$1 AND l.revision=$2 AND l.game_id=$3
        AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)`, [id, revision, game])
    if (!level) throw new HttpError(404, 'puzzle_revision_unavailable')
    return level
  })
}
