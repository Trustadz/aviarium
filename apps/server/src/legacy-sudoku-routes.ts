import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { quickPlayDescriptorSchema, quickPlayVersion, type QuickPlayDescriptor } from '../../../packages/sudoku/src/contracts.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { quickPlayId } from '../../../packages/sudoku/src/seed-code.js'
import { HttpError, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment } from './config.js'
import type { LevelRecord } from './game-runtime.js'
import { registerLevels } from './levels.js'
import { getQuickPlayLevel } from './quick-play.js'

/**
 * Quarantined Sudoku-only routes from before the platform had a generic game
 * API. They are kept for old clients and the existing browser tests; new
 * clients use /api/games/:game/quick-play and /api/games/:game/levels/:id/:revision.
 */
export function registerLegacySudokuRoutes(app: FastifyInstance) {
  registerLevels(app)
  app.post('/api/sudoku/quick-play', async request => {
    if (loginEnabled || testEnvironment) await requireUser(request)
    const input = quickPlayDescriptorSchema.partial({ seed: true, version: true }).parse(request.body)
    const descriptor: QuickPlayDescriptor = {
      difficulty: input.difficulty, seed: input.seed ?? randomBytes(8).toString('hex'), version: quickPlayVersion,
    }
    return getQuickPlayLevel(pool, await quickPlayId(descriptor), descriptor)
  })
  app.get('/api/sudoku/level/:id/:revision', async request => {
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { id, revision } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/),
      revision: z.coerce.number().int().positive() }).parse(request.params)
    const { rows: [level] } = await pool.query<LevelRecord>(`SELECT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,
      l.source,l.seed,l.generator_version AS "generatorVersion" FROM published_levels l
      WHERE l.id=$1 AND l.revision=$2 AND l.game_id=$3 AND l.catalog_visible
        AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)`, [id, revision, sudoku.id])
    if (!level) throw new HttpError(404, 'puzzle_revision_unavailable')
    return level
  })
}
