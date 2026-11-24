import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { locales } from '../../../packages/game-sdk/src/locales.js'
import { isResumable, mutationHeader, savedGameLimit, type AttemptMutation, type SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
import { effectivePackRules, packProgress, packProgressPath, type PackCompletion, type PackDocument, type PackRevision, type ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'
import { accountRoleSchema, digest, HttpError, requireUser, userFields, withLegacyEditorGames, type User } from './auth.js'
import { pool, transaction } from './config.js'
import { recordChallengeResult, recordLeaderboardResult } from './leaderboards.js'
import type { ChallengeResultContext } from './leaderboards.js'
import { requestNow } from './challenges/now.js'
import { challengeGames } from './challenges/registry.js'
import type { OccurrenceRow, SlotRow } from './challenges/store.js'
import { packHistory } from './pack-progress.js'

const fields = 'id,revision,data,parent_id AS "parentId",archived,floor(extract(epoch FROM updated_at) * 1000)::double precision AS "updatedAt"'
const preferenceFields = (games: ReadonlyMap<string, ServerGame>) =>
  Object.assign({}, ...[...games.values()].map(game => game.preferences?.shape ?? {})) as Record<string, z.ZodType>
const continueOrder = 'updated_at DESC NULLS LAST, revision DESC, id DESC'

interface ChallengeAttemptRow {
  id: string
  slot_id: string
  occurrence_id: string
  owner_id: string
  session_id: string
  status: 'started' | 'completed' | 'closed'
  started_at: Date | string
  completed_at: Date | string | null
}

interface ChallengeMutationResult extends SavedAttempt {
  challenge: { attemptId: string; status: 'started' | 'completed' | 'closed'; ranked: boolean; invalid?: boolean }
}

async function writeChallengeSave(db: PoolClient, user: User, mutation: AttemptMutation,
  now: number): Promise<SavedAttempt> {
  const updatedAt = new Date(Math.min(mutation.updatedAt ?? now, now))
  const { rows: [existing] } = await db.query<SavedAttempt>(`SELECT ${fields} FROM saves WHERE id=$1 AND owner_id=$2`,
    [mutation.sessionId, user.id])
  if (existing) {
    const { rows: [saved] } = await db.query<SavedAttempt>(`UPDATE saves SET data=$1,revision=revision+1,
      archived=$2,updated_at=GREATEST(updated_at,$3) WHERE id=$4 AND owner_id=$5 RETURNING ${fields}`,
    [mutation.data, mutation.archived, updatedAt, mutation.sessionId, user.id])
    if (saved) return saved
  }
  const { rows: [saved] } = await db.query<SavedAttempt>(`INSERT INTO saves(id,owner_id,data,parent_id,archived,updated_at)
    VALUES($1,$2,$3,NULL,$4,$5) RETURNING ${fields}`,
  [mutation.sessionId, user.id, mutation.data, mutation.archived, updatedAt])
  return saved!
}

async function closeChallengeAttempt(db: PoolClient, attempt: ChallengeAttemptRow, now: number) {
  await db.query(`UPDATE challenge_attempts SET status='closed', completed_at=$2 WHERE id=$1`,
    [attempt.id, new Date(now)])
}

async function handleChallengeMutation(db: PoolClient, user: User, game: ServerGame, level: LevelRecord,
  mutation: AttemptMutation, now: number): Promise<ChallengeMutationResult> {
  const claim = mutation.challenge!
  const { rows: [attempt] } = await db.query<ChallengeAttemptRow>(`SELECT * FROM challenge_attempts
    WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [claim.attemptId, user.id])
  if (!attempt || attempt.session_id !== mutation.sessionId || attempt.owner_id !== user.id)
    throw new HttpError(409, 'challenge_attempt_mismatch')
  if (mutation.data.game !== game.id || mutation.data.level !== level.id ||
      mutation.data.levelRevision !== level.revision || mutation.data.ruleset !== level.ruleset)
    throw new HttpError(409, 'challenge_attempt_mismatch')

  const { rows: [slot] } = await db.query<SlotRow>('SELECT * FROM challenge_slots WHERE id=$1', [attempt.slot_id])
  const { rows: [occurrence] } = await db.query<OccurrenceRow>('SELECT * FROM challenge_occurrences WHERE id=$1',
    [attempt.occurrence_id])
  if (!slot || !occurrence || slot.game_id !== game.id || slot.level_id !== level.id ||
      slot.level_revision !== level.revision || slot.status !== 'ready')
    throw new HttpError(409, 'challenge_attempt_mismatch')
  if (level.source !== 'Challenge') throw new HttpError(409, 'challenge_attempt_mismatch')

  const saved = await writeChallengeSave(db, user, mutation, now)
  const ended = now >= new Date(occurrence.ends_at).getTime()
  const finish = async (status: 'started' | 'completed' | 'closed', ranked: boolean,
    invalid?: boolean): Promise<ChallengeMutationResult> => {
    const result: ChallengeMutationResult = {
      ...saved,
      challenge: { attemptId: attempt.id, status, ranked, ...(invalid ? { invalid } : {}) },
    }
    await db.query('INSERT INTO sync_receipts(owner_id,id,fingerprint,result) VALUES($1,$2,$3,$4)',
      [user.id, mutation.mutationId, digest(JSON.stringify(mutation)), result])
    return result
  }

  if (attempt.status === 'completed') return finish('completed', true)
  if (attempt.status === 'closed') return finish('closed', false)
  if (mutation.archived) {
    await closeChallengeAttempt(db, attempt, now)
    return finish('closed', false)
  }
  if (!mutation.data.completed && mutation.data.lives === 0) {
    await closeChallengeAttempt(db, attempt, now)
    return finish('closed', false)
  }
  if (!mutation.data.completed) {
    if (ended) {
      await closeChallengeAttempt(db, attempt, now)
      return finish('closed', false)
    }
    return finish('started', false)
  }

  try {
    game.validateAttempt(mutation.data, level)
  } catch {
    await closeChallengeAttempt(db, attempt, now)
    return finish('closed', false, true)
  }

  if (ended) {
    await db.query(`INSERT INTO completions(owner_id,level_id,level_revision) VALUES($1,$2,$3)
      ON CONFLICT DO NOTHING`, [user.id, level.id, level.revision])
    await closeChallengeAttempt(db, attempt, now)
    return finish('closed', false)
  }

  const adapter = challengeGames.find(item => item.id === slot.game_id)
  if (!adapter) throw new HttpError(409, 'challenge_game_unsupported')
  const record = adapter.record(level, mutation.data, slot.rules)
  // The server start time is authoritative for time-based challenges. Leaving
  // and resuming cannot reduce the recorded time, and a client cannot report a
  // faster run than the wall clock allows.
  if (record.unit === 'ms') {
    const elapsed = Math.max(0, now - new Date(attempt.started_at).getTime())
    if (Number.isFinite(elapsed) && elapsed > record.value) record.value = elapsed
  }
  const context: ChallengeResultContext = {
    slotId: slot.id, attemptId: attempt.id, occurrenceId: occurrence.id, periodKey: occurrence.period_key,
    timeZone: occurrence.timezone, game: slot.game_id, options: slot.options, rules: slot.rules,
  }
  await recordChallengeResult(db, user, game, level, saved, context, record, new Date(now))
  await db.query(`UPDATE challenge_attempts SET status='completed', completed_at=$2 WHERE id=$1`,
    [attempt.id, new Date(now)])
  await db.query(`INSERT INTO completions(owner_id,level_id,level_revision) VALUES($1,$2,$3)
    ON CONFLICT DO NOTHING`, [user.id, level.id, level.revision])
  return finish('completed', true)
}


export function registerProgress(app: FastifyInstance, serverGames: ReadonlyMap<string, ServerGame>) {
  const preferencesPatch = z.object({ ...preferenceFields(serverGames), locale: z.enum(locales) }).partial()
  app.get('/api/progress', async request => {
    const user = await requireUser(request)
    const [saves, completions, prefs, levels] = await Promise.all([
      pool.query<SavedAttempt>(`SELECT ${fields} FROM saves WHERE owner_id=$1 ORDER BY ${continueOrder}`, [user.id]),
      pool.query('SELECT level_id AS level,level_revision AS revision FROM completions WHERE owner_id=$1', [user.id]),
      pool.query('SELECT revision,data FROM preferences WHERE owner_id=$1', [user.id]),
      pool.query(`SELECT DISTINCT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,l.source,l.pack,l.content,l.game_id AS game,
        l.seed,l.generator_version AS "generatorVersion"
        FROM saves s JOIN published_levels l ON l.id=s.data->>'level' AND l.revision=(s.data->>'levelRevision')::int
        WHERE s.owner_id=$1 AND (NOT s.archived OR s.data->>'completed'='true')`, [user.id]),
    ])
    return { sessions: saves.rows, completions: completions.rows, prefs: prefs.rows[0] ?? { revision: 0, data: {} }, levels: levels.rows }
  })
  app.post('/api/progress', async request => {
    const user = await requireUser(request)
    const game = serverGames.get(mutationHeader.parse(request.body).data.game)
    if (!game) throw new HttpError(422, 'level_version_unavailable')
    const mutation = game.readMutation(request.body)
    const fingerprint = digest(JSON.stringify(mutation))
    return transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
      const receipt = (await db.query('SELECT fingerprint,result FROM sync_receipts WHERE owner_id=$1 AND id=$2',
        [user.id, mutation.mutationId])).rows[0]
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new HttpError(409, 'mutation_conflict')
        return receipt.result as SavedAttempt
      }
      const { rows: [published] } = await db.query<LevelRecord>(
        `SELECT id,revision,ruleset,title,grid,content,difficulty,source,pack,seed,generator_version AS "generatorVersion"
          FROM published_levels WHERE id=$1 AND revision=$2 AND game_id=$3`, [mutation.data.level, mutation.data.levelRevision, game.id])
      const level = published ?? await game.resolveGeneratedLevel?.(db, mutation)
      if (!level || level.ruleset !== mutation.data.ruleset) throw new HttpError(422, 'level_version_unavailable')
      let packRules: ProgressionRules | undefined
      let activePack: PackRevision | undefined
      if (level.pack && (!level.pack.legacyStandalone || mutation.data.packRevision !== undefined)) {
        const packRevision = mutation.data.packRevision ?? level.pack.revision
        const { rows: [snapshot] } = await db.query<{ data: PackDocument }>(
          'SELECT data FROM pack_revisions WHERE pack_id=$1 AND revision=$2', [level.pack.id, packRevision])
        if (!snapshot) throw new HttpError(422, 'level_version_unavailable')
        const pack: PackRevision = { id: level.pack.id, revision: packRevision, builtIn: false, data: snapshot.data }
        activePack = pack
        const index = packProgressPath(pack).stops.findIndex(item =>
          item.id === mutation.data.level && item.revision === mutation.data.levelRevision)
        if (index < 0) throw new HttpError(422, 'level_version_unavailable')
        packRules = effectivePackRules(pack, index + 1)
        if (packRules.inOrder && index) {
          pack.history = (await packHistory(db, [pack])).get(pack.id)
          const { rows } = await db.query<PackCompletion>(`SELECT c.level_id AS level,c.level_revision AS revision,
            (s.data->>'packRevision')::int AS "packRevision"
            FROM completions c LEFT JOIN saves s ON s.owner_id=c.owner_id AND s.data->>'level'=c.level_id
              AND (s.data->>'levelRevision')::int=c.level_revision AND s.data->>'completed'='true'
            JOIN published_levels l ON l.id=c.level_id AND l.revision=c.level_revision
            WHERE c.owner_id=$1 AND l.pack IS NOT NULL AND l.pack->>'id'=$2`, [user.id, pack.id])
          if (!packProgress(pack, rows).playable[index]) throw new HttpError(422, 'pack_stop_locked')
        }
      } else if (mutation.data.packRevision !== undefined) {
        throw new HttpError(422, 'level_version_unavailable')
      }
      if (mutation.challenge)
        return handleChallengeMutation(db, user, game, level, mutation, requestNow(request))
      if (level.source === 'Challenge') throw new HttpError(422, 'challenge_required')
      game.validateAttempt(mutation.data, level, packRules)
      const lives = mutation.data.lives
      const existing = (await db.query<SavedAttempt>(`SELECT ${fields} FROM saves WHERE id=$1 AND owner_id=$2`,
        [mutation.sessionId, user.id])).rows[0]
      if (existing && (existing.data.game !== mutation.data.game || existing.data.level !== mutation.data.level || existing.data.levelRevision !== mutation.data.levelRevision ||
          (existing.data.packRevision ?? level.pack?.revision) !== (mutation.data.packRevision ?? level.pack?.revision)))
        throw new HttpError(422, 'attempt_level_mismatch')
      if (existing?.revision === mutation.baseRevision && existing.data.lives !== undefined &&
          lives !== undefined && lives > existing.data.lives)
        throw new HttpError(422, 'attempt_reset_required')
      let saved: SavedAttempt
      const now = Date.now()
      const updatedAt = new Date(Math.min(mutation.updatedAt ?? now, now))
      if (existing && (existing.archived ||
          (mutation.archived && mutation.archiveIfUnchanged && existing.revision !== mutation.baseRevision))) {
        saved = existing
      } else if (existing && mutation.archived) {
        saved = (await db.query<SavedAttempt>(`UPDATE saves SET archived=true,revision=revision+1
          WHERE id=$1 AND owner_id=$2 RETURNING ${fields}`, [mutation.sessionId, user.id])).rows[0]
      } else if (existing?.revision === mutation.baseRevision && (!existing.data.completed || mutation.data.completed)) {
        saved = (await db.query<SavedAttempt>(`UPDATE saves SET data=$1,revision=revision+1,updated_at=GREATEST(updated_at,$2)
          WHERE id=$3 AND owner_id=$4 RETURNING ${fields}`, [mutation.data, updatedAt, mutation.sessionId, user.id])).rows[0]
      } else {
        saved = (await db.query<SavedAttempt>(`INSERT INTO saves(id,owner_id,data,parent_id,archived,updated_at)
          VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING ${fields}`,
        [existing ? null : mutation.sessionId, user.id, mutation.data, existing?.id, mutation.archived, updatedAt])).rows[0]
        if (!saved) throw new HttpError(409, 'session_id_conflict')
      }
      if (isResumable(saved)) {
        const expired = await db.query<SavedAttempt>(`UPDATE saves SET archived=true,revision=revision+1
          WHERE id IN (SELECT id FROM saves WHERE owner_id=$1 AND NOT archived AND data->>'completed' = 'false'
            AND COALESCE(data->>'lives','1') <> '0'
            AND NOT EXISTS (SELECT 1 FROM challenge_attempts a WHERE a.session_id=saves.id AND a.status='started')
            ORDER BY ${continueOrder} OFFSET $2) RETURNING ${fields}`, [user.id, savedGameLimit])
        saved = expired.rows.find(item => item.id === saved.id) ?? saved
      }
      if (mutation.data.completed) {
        await db.query(`INSERT INTO completions(owner_id,level_id,level_revision)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [user.id, mutation.data.level, mutation.data.levelRevision])
        await recordLeaderboardResult(db, user, game, level, mutation, saved, activePack)
      }
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
    return (await pool.query<User>(`SELECT ${userFields} FROM users u ORDER BY u.name,u.id`)).rows.map(withLegacyEditorGames)
  })
  app.patch('/api/admin/users/:id', async request => {
    const admin = await requireUser(request, 'admin')
    const id = z.uuid().parse((request.params as { id: string }).id)
    const { role } = z.strictObject({ role: accountRoleSchema }).parse(request.body)
    if (id === admin.id && role !== 'admin')
      throw new HttpError(409, 'admin_role_self_change')
    const { rows: [updated] } = await pool.query<User>(`UPDATE users u SET role=$1 WHERE u.id=$2 RETURNING ${userFields}`, [role, id])
    if (!updated) throw new HttpError(404, 'account_not_found')
    return withLegacyEditorGames(updated)
  })
}
