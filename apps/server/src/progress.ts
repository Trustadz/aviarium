import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mutationSchema, preferenceSchema, type StoredSession } from '../../../packages/sudoku/src/contracts.js'
import { rules } from '../../../packages/sudoku/src/rules.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { digest, HttpError, requireUser, userFields, type User } from './auth.js'
import { pool, transaction } from './config.js'

const fields = 'id,revision,data,parent_id AS "parentId",archived'

export function registerProgress(app: FastifyInstance) {
  app.get('/api/progress', async request => {
    const user = await requireUser(request)
    const [saves, completions, prefs, levels] = await Promise.all([
      pool.query<StoredSession>(`SELECT ${fields} FROM saves WHERE owner_id=$1`, [user.id]),
      pool.query('SELECT level_id AS level,level_revision AS revision FROM completions WHERE owner_id=$1', [user.id]),
      pool.query('SELECT revision,data FROM preferences WHERE owner_id=$1', [user.id]),
      pool.query(`SELECT DISTINCT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,l.source
        FROM saves s JOIN published_levels l ON l.id=s.data->>'level' AND l.revision=(s.data->>'levelRevision')::int
        WHERE s.owner_id=$1 AND NOT s.archived`, [user.id]),
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
        if (receipt.fingerprint !== fingerprint) throw new HttpError(409, 'This mutation ID was already used.')
        return receipt.result as StoredSession
      }
      const level = (await db.query<{grid: string; ruleset: number}>(`SELECT grid,ruleset FROM published_levels
        WHERE id=$1 AND revision=$2`, [mutation.data.level, mutation.data.levelRevision])).rows[0]
      if (!level || level.ruleset !== mutation.data.ruleset) throw new HttpError(422, 'That level version is unavailable.')
      const givens = Array.from(level.grid, Number)
      for (const board of [mutation.data.board, ...mutation.data.undo, ...mutation.data.redo]) {
        if (givens.some((given, cell) => given && board.entries[cell] !== given))
          throw new HttpError(422, 'The save modifies fixed givens.')
      }
      if (mutation.data.completed && !rules.verify(givens, mutation.data.board.entries))
        throw new HttpError(422, 'This save does not contain a valid solution.')
      const existing = (await db.query<StoredSession>(`SELECT ${fields} FROM saves WHERE id=$1 AND owner_id=$2`,
        [mutation.sessionId, user.id])).rows[0]
      if (existing && (existing.data.level !== mutation.data.level || existing.data.levelRevision !== mutation.data.levelRevision))
        throw new HttpError(422, 'A saved attempt is bound to one level revision.')
      let saved: StoredSession
      if (existing?.revision === mutation.baseRevision && (!existing.archived || mutation.archived) &&
          (!existing.data.completed || mutation.data.completed)) {
        saved = (await db.query<StoredSession>(`UPDATE saves SET data=$1,revision=revision+1,archived=$2
          WHERE id=$3 AND owner_id=$4 RETURNING ${fields}`, [mutation.data, mutation.archived, mutation.sessionId, user.id])).rows[0]
      } else {
        saved = (await db.query<StoredSession>(`INSERT INTO saves(id,owner_id,data,parent_id,archived)
          VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING ${fields}`,
        [existing ? null : mutation.sessionId, user.id, mutation.data, existing?.id, mutation.archived])).rows[0]
        if (!saved) throw new HttpError(409, 'The session ID is already in use.')
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
    const patch = preferenceSchema.partial().parse(request.body)
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
      throw new HttpError(409, 'Another admin must change your role.')
    return transaction(async db => {
      const found = await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id])
      if (!found.rowCount) throw new HttpError(404, 'Account was not found.')
      if ('role' in patch) await db.query('UPDATE users SET role=$1 WHERE id=$2', [patch.role, id])
      else if (patch.enabled) await db.query('INSERT INTO game_editors (user_id,game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, patch.editor])
      else await db.query('DELETE FROM game_editors WHERE user_id=$1 AND game_id=$2', [id, patch.editor])
      return (await db.query<User>(`SELECT ${userFields} FROM users u WHERE u.id=$1`, [id])).rows[0]
    })
  })
}
