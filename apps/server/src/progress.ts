import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { locales } from '../../../packages/game-sdk/src/locales.js'
import { savedGameLimit } from '../../../packages/game-sdk/src/index.js'
import { mutationSchema, preferenceSchema, type StoredSession } from '../../../packages/sudoku/src/contracts.js'
import { rules } from '../../../packages/sudoku/src/rules.js'
import { packLevelId, type PackRules } from '../../../packages/sudoku/src/packs.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { quickPlayId } from '../../../packages/sudoku/src/seed-code.js'
import { digest, HttpError, requireUser, userFields, type User } from './auth.js'
import { pool, transaction } from './config.js'
import { getQuickPlayLevel } from './quick-play.js'

const fields = 'id,revision,data,parent_id AS "parentId",archived,floor(extract(epoch FROM updated_at) * 1000)::double precision AS "updatedAt"'
const preferencesPatch = preferenceSchema.extend({ locale: z.enum(locales) }).partial()
const continueOrder = 'updated_at DESC NULLS LAST, revision DESC, id DESC'

export function registerProgress(app: FastifyInstance) {
  app.get('/api/progress', async request => {
    const user = await requireUser(request)
    const [saves, completions, prefs, levels] = await Promise.all([
      pool.query<StoredSession>(`SELECT ${fields} FROM saves WHERE owner_id=$1 ORDER BY ${continueOrder}`, [user.id]),
      pool.query('SELECT level_id AS level,level_revision AS revision FROM completions WHERE owner_id=$1', [user.id]),
      pool.query('SELECT revision,data FROM preferences WHERE owner_id=$1', [user.id]),
      pool.query(`SELECT DISTINCT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,l.source,l.pack,
        l.seed,l.generator_version AS "generatorVersion"
        FROM saves s JOIN published_levels l ON l.id=s.data->>'level' AND l.revision=(s.data->>'levelRevision')::int
        WHERE s.owner_id=$1 AND (NOT s.archived OR s.data->>'completed'='true')`, [user.id]),
    ])
    return { sessions: saves.rows, completions: completions.rows, prefs: prefs.rows[0] ?? { revision: 0, data: {} }, levels: levels.rows }
  })
  app.post('/api/progress', async request => {
    const user = await requireUser(request)
    const mutation = mutationSchema.parse(request.body)
    const fingerprint = digest(JSON.stringify(mutation))
    return transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
      const receipt = (await db.query('SELECT fingerprint,result FROM sync_receipts WHERE owner_id=$1 AND id=$2',
        [user.id, mutation.mutationId])).rows[0]
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new HttpError(409, 'mutation_conflict')
        return receipt.result as StoredSession
      }
      let level = (await db.query<{grid: string; ruleset: number; pack: { id: string; stop: number } | null; packRules: PackRules | null}>(
        `SELECT l.grid,l.ruleset,l.pack,p.data->'rules' AS "packRules" FROM published_levels l
        LEFT JOIN sudoku_pack_revisions p ON p.pack_id=l.pack->>'id' AND p.revision=l.revision
        WHERE l.id=$1 AND l.revision=$2`, [mutation.data.level, mutation.data.levelRevision])).rows[0]
      if (!level && mutation.quickPlay && mutation.data.levelRevision === 1 &&
          await quickPlayId(mutation.quickPlay) === mutation.data.level) {
        const generated = await getQuickPlayLevel(db, mutation.data.level, mutation.quickPlay)
        level = { grid: generated.grid, ruleset: generated.ruleset, pack: null, packRules: null }
      }
      if (!level || level.ruleset !== mutation.data.ruleset) throw new HttpError(422, 'level_version_unavailable')
      if (level.pack && level.packRules?.inOrder && level.pack.stop > 1) {
        const previous = packLevelId(level.pack.id, level.pack.stop - 1)
        const unlocked = (await db.query(`SELECT 1 FROM completions
          WHERE owner_id=$1 AND level_id=$2 AND level_revision=$3`, [user.id, previous, mutation.data.levelRevision])).rowCount
        if (!unlocked) throw new HttpError(422, 'pack_stop_locked')
      }
      const limit = level.packRules?.lives
      const lives = mutation.data.lives
      if (limit ? lives === undefined || lives > limit || (lives === 0 && mutation.data.completed) : lives !== undefined)
        throw new HttpError(422, 'lives_rule_mismatch')
      const givens = Array.from(level.grid, Number)
      for (const board of [mutation.data.board, ...mutation.data.undo, ...mutation.data.redo]) {
        if (givens.some((given, cell) => given && board.entries[cell] !== given))
          throw new HttpError(422, 'fixed_digits_changed')
      }
      if (mutation.data.completed && !rules.verify(givens, mutation.data.board.entries))
        throw new HttpError(422, 'saved_solution_invalid')
      const existing = (await db.query<StoredSession>(`SELECT ${fields} FROM saves WHERE id=$1 AND owner_id=$2`,
        [mutation.sessionId, user.id])).rows[0]
      if (existing && (existing.data.level !== mutation.data.level || existing.data.levelRevision !== mutation.data.levelRevision))
        throw new HttpError(422, 'attempt_level_mismatch')
      if (existing?.revision === mutation.baseRevision && existing.data.lives !== undefined &&
          lives !== undefined && lives > existing.data.lives)
        throw new HttpError(422, 'attempt_reset_required')
      let saved: StoredSession
      const now = Date.now()
      const updatedAt = new Date(Math.min(mutation.updatedAt ?? now, now))
      if (existing && (existing.archived ||
          (mutation.archived && mutation.archiveIfUnchanged && existing.revision !== mutation.baseRevision))) {
        saved = existing
      } else if (existing && mutation.archived) {
        saved = (await db.query<StoredSession>(`UPDATE saves SET archived=true,revision=revision+1
          WHERE id=$1 AND owner_id=$2 RETURNING ${fields}`, [mutation.sessionId, user.id])).rows[0]
      } else if (existing?.revision === mutation.baseRevision && (!existing.data.completed || mutation.data.completed)) {
        saved = (await db.query<StoredSession>(`UPDATE saves SET data=$1,revision=revision+1,updated_at=GREATEST(updated_at,$2)
          WHERE id=$3 AND owner_id=$4 RETURNING ${fields}`, [mutation.data, updatedAt, mutation.sessionId, user.id])).rows[0]
      } else {
        saved = (await db.query<StoredSession>(`INSERT INTO saves(id,owner_id,data,parent_id,archived,updated_at)
          VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING ${fields}`,
        [existing ? null : mutation.sessionId, user.id, mutation.data, existing?.id, mutation.archived, updatedAt])).rows[0]
        if (!saved) throw new HttpError(409, 'session_id_conflict')
      }
      if (!saved.archived && !saved.data.completed && saved.data.lives !== 0) {
        const expired = await db.query<StoredSession>(`UPDATE saves SET archived=true,revision=revision+1
          WHERE id IN (SELECT id FROM saves WHERE owner_id=$1 AND NOT archived AND data->>'completed' = 'false'
            AND COALESCE(data->>'lives','1') <> '0'
            ORDER BY ${continueOrder} OFFSET $2) RETURNING ${fields}`, [user.id, savedGameLimit])
        saved = expired.rows.find(item => item.id === saved.id) ?? saved
      }
      if (mutation.data.completed) await db.query(`INSERT INTO completions(owner_id,level_id,level_revision)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [user.id, mutation.data.level, mutation.data.levelRevision])
      await db.query('INSERT INTO sync_receipts(owner_id,id,fingerprint,result) VALUES($1,$2,$3,$4)',
        [user.id, mutation.mutationId, fingerprint, saved])
      return saved
    })
  })
  app.patch('/api/preferences', async request => {
    const user = await requireUser(request)
    const patch = preferencesPatch.parse(request.body)
    const { rows: [result] } = await pool.query(`INSERT INTO preferences(owner_id,data,revision) VALUES($1,$2,1)
      ON CONFLICT (owner_id) DO UPDATE SET data=preferences.data || excluded.data,revision=preferences.revision+1
      RETURNING revision,data`, [user.id, patch])
    return result
  })
  app.get('/api/admin/users', async request => {
    await requireUser(request, 'admin')
    return (await pool.query<User>(`SELECT ${userFields} FROM users u ORDER BY u.name,u.id`)).rows
  })
  app.patch('/api/admin/users/:id', async request => {
    const admin = await requireUser(request, 'admin')
    const id = z.uuid().parse((request.params as { id: string }).id)
    const patch = z.union([
      z.strictObject({ role: z.enum(['user', 'admin']) }),
      z.strictObject({ editor: z.literal(sudoku.id), enabled: z.boolean() }),
    ]).parse(request.body)
    if ('role' in patch && id === admin.id && patch.role !== 'admin')
      throw new HttpError(409, 'admin_role_self_change')
    return transaction(async db => {
      const found = await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id])
      if (!found.rowCount) throw new HttpError(404, 'account_not_found')
      if ('role' in patch) await db.query('UPDATE users SET role=$1 WHERE id=$2', [patch.role, id])
      else if (patch.enabled) await db.query('INSERT INTO game_editors (user_id,game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, patch.editor])
      else await db.query('DELETE FROM game_editors WHERE user_id=$1 AND game_id=$2', [id, patch.editor])
      return (await db.query<User>(`SELECT ${userFields} FROM users u WHERE u.id=$1`, [id])).rows[0]
    })
  })
}
