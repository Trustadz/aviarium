import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { assignPackLevels, authoringPack, packUploadBytes, type PackDocument, type PackDraftRecord, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import { HttpError, requireEditor, requireUser, type User } from './auth.js'
import { loginEnabled, pool, testEnvironment, transaction } from './config.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'
import { packHistory } from './pack-progress.js'
import { exportPack, importPack, packManifest, readPackDraft } from './pack-content.js'

const draftFields = 'id,draft_version AS version,published_revision AS published,visible,draft AS data,last_edited_by AS "lastEditedBy"'
const packId = z.string().regex(/^[a-z0-9-]{1,64}$/)
const revision = z.coerce.number().int().positive()
const idOf = (request: FastifyRequest) => packId.parse((request.params as { id: string }).id)
const limit = Math.ceil(packUploadBytes / 3) * 4 + 256
async function player(request: FastifyRequest) {
  if (loginEnabled || testEnvironment) return requireUser(request)
}

async function publishRevision(db: PoolClient, game: ServerGame, pack: PackRevision, owner?: string) {
  await db.query('INSERT INTO pack_revisions(pack_id,revision,data) VALUES($1,$2,$3)',
    [pack.id, pack.revision, pack.data])
  for (const level of game.packs.levels(pack)) {
    await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,author_id,
      seed,generator_version,validation,catalog_visible,pack,game_id,content)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unique',false,$11,$12,$13)
      ON CONFLICT (id,revision) DO NOTHING`,
    [level.id, level.revision, level.ruleset, level.title, level.grid, level.difficulty, level.source, owner,
      level.seed, level.generatorVersion, level.pack, game.id,
      level.content === undefined ? null : JSON.stringify(level.content)])
  }
}

export async function seedPacks(db: PoolClient, game: ServerGame) {
  for (const definition of game.packs.builtIn) {
    const { id, revision, coverFile } = definition
    const draft = { ...definition.data }
    if (coverFile) {
      const art = await readFile(new URL('../../../../dist/web/' + coverFile, import.meta.url))
      draft.cover = 'data:image/webp;base64,' + art.toString('base64')
    }
    const owner = (await db.query<{ game_id: string; owner_id: string | null }>('SELECT game_id,owner_id FROM packs WHERE id=$1', [id])).rows[0]
    if (owner && (owner.game_id !== game.id || owner.owner_id)) throw new Error('Conflicting built-in pack ID: ' + id)
    if ((await db.query('SELECT 1 FROM pack_revisions WHERE pack_id=$1 AND revision=$2', [id, revision])).rowCount) {
      // Replacing bundled cover art leaves the puzzle revision and existing progress pinned.
      if (draft.cover) {
        await db.query(`UPDATE pack_revisions r SET data=jsonb_set(r.data,'{cover}',to_jsonb($3::text))
          FROM packs p WHERE p.id=r.pack_id AND p.owner_id IS NULL AND r.pack_id=$1 AND r.revision=$2
          AND r.data->>'cover' IS DISTINCT FROM $3`, [id, revision, draft.cover])
        await db.query(`UPDATE packs SET draft=jsonb_set(draft,'{cover}',to_jsonb($3::text))
          WHERE id=$1 AND owner_id IS NULL AND published_revision=$2 AND draft->>'cover' IS DISTINCT FROM $3`,
        [id, revision, draft.cover])
      }
      continue
    }
    const data = await game.packs.verify(readPackDraft(game.packs, draft), [])
    await db.query(`INSERT INTO packs(id,draft,published_revision,game_id) VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET draft=excluded.draft,published_revision=excluded.published_revision
      WHERE packs.owner_id IS NULL AND packs.published_revision < excluded.published_revision`, [id, data, revision, game.id])
    await publishRevision(db, game, { id, revision, builtIn: true, data })
  }
}

async function gradeInBackground(game: ServerGame, draft: PackDocument, previouslyVerified: readonly LevelRecord[] = []): Promise<PackDocument> {
  const worker = new Worker(new URL('./pack-grade-task.js', import.meta.url), {
    workerData: { game: game.id, draft, previouslyVerified }, resourceLimits: { maxOldGenerationSizeMb: 96 },
  })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HttpError(422, 'pack_verification_timeout')), 75_000)
      const finish = () => clearTimeout(timer)
      worker.once('message', result => {
        finish()
        if (result.error) reject(new HttpError(result.error.status, result.error.code, result.error.values))
        else resolve(result.data)
      })
      worker.once('error', error => { finish(); reject(error) })
      worker.once('exit', code => { finish(); reject(new Error('Pack verifier exited: ' + code)) })
    })
  } finally { await worker.terminate() }
}

export function registerPacks(app: FastifyInstance, game: ServerGame, prefix: string) {
  const path = (route: string) => prefix + route
  app.get(path('/packs'), async request => {
    await player(request)
    const { rows } = await pool.query<PackRevision>(`SELECT p.id,r.revision,p.owner_id IS NULL AS "builtIn",r.data
      FROM packs p JOIN pack_revisions r ON r.pack_id=p.id AND r.revision=p.published_revision
      WHERE p.game_id=$1 AND p.visible AND p.deleted_at IS NULL ORDER BY p.owner_id IS NOT NULL,r.data->>'title',p.id`, [game.id])
    const history = await packHistory(pool, rows)
    return rows.map(pack => ({ ...pack, history: history.get(pack.id) }))
  })
  async function loadPack(request: FastifyRequest) {
    const id = idOf(request)
    const rev = revision.parse((request.params as { revision: string }).revision)
    const { rows: [pack] } = await pool.query<PackRevision & { ownerId: string | null }>(`SELECT p.id,r.revision,
      p.owner_id IS NULL AS "builtIn",p.owner_id AS "ownerId",r.data
      FROM packs p JOIN pack_revisions r ON r.pack_id=p.id WHERE p.id=$1 AND r.revision=$2 AND p.game_id=$3`, [id, rev, game.id])
    if (!pack) throw new HttpError(404, 'pack_revision_unavailable')
    return pack
  }
  app.get(path('/packs/:id/:revision'), async request => {
    const user = await player(request)
    const { ownerId, ...pack } = await loadPack(request)
    const history = (await packHistory(pool, [pack])).get(pack.id)
    return { ...pack, history, ownedByViewer: Boolean(user && user.id === ownerId) }
  })
  app.get(path('/packs/:id/:revision/export'), async (request, reply) => {
    const user = await requireEditor(request)
    const pack = await loadPack(request)
    if (user.role !== 'admin' && pack.ownerId !== user.id)
      throw new HttpError(403, 'pack_export_denied')
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${pack.id}.aviarium-pack"`)
      .send(exportPack(game.packs, pack.data))
  })

  async function newDraft(owner: string, data: PackDocument, id: string = randomUUID()) {
    const { rows: [created] } = await pool.query<PackDraftRecord>(`INSERT INTO packs(id,owner_id,draft,last_edited_by,visible,game_id)
      VALUES($1,$2,$3,$2,false,$4) ON CONFLICT DO NOTHING RETURNING ${draftFields}`, [id, owner, data, game.id])
    if (created) return created
    const { rows: [existing] } = await pool.query<PackDraftRecord>(`SELECT ${draftFields} FROM packs
      WHERE id=$1 AND owner_id=$2 AND draft=$3 AND game_id=$4 AND deleted_at IS NULL`, [id, owner, data, game.id])
    if (!existing) throw new HttpError(409, 'pack_draft_save_conflict')
    return existing
  }

  async function draftAccess(request: FastifyRequest): Promise<{ actor: User; admin: boolean }> {
    const admin = (request.query as { mode?: string }).mode === 'admin'
    return { actor: admin ? await requireUser(request, 'admin') : await requireEditor(request), admin }
  }

  app.get(path('/pack-drafts'), async request => {
    const { actor, admin } = await draftAccess(request)
    return (await pool.query<PackDraftRecord>(`SELECT ${draftFields},
      (SELECT COALESCE(u.display_name,u.name) FROM users u WHERE u.id=packs.owner_id) AS "ownerName"
      FROM packs WHERE owner_id IS NOT NULL AND (owner_id=$1 OR $2) AND game_id=$3 AND deleted_at IS NULL ORDER BY draft->>'title',id`, [actor.id, admin, game.id])).rows.map(draft => ({ ...draft, data: authoringPack(draft.data) }))
  })
  app.post(path('/pack-drafts'), { bodyLimit: limit }, async request => {
    const user = await requireEditor(request)
    const { localId } = z.object({ localId: z.uuid().optional() }).parse(request.body)
    return newDraft(user.id, readPackDraft(game.packs, request.body), localId)
  })
  app.post(path('/pack-drafts/import'), { bodyLimit: limit }, async request => {
    const user = await requireEditor(request)
    const { content } = z.object({ content: z.string().max(limit).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).parse(request.body)
    const draft = importPack(game.packs, Buffer.from(content, 'base64'))
    // Imported levels get new identities on this installation.
    draft.puzzles = draft.puzzles.map(({ levelId: _id, levelRevision: _revision, ...level }) => level)
    return newDraft(user.id, await gradeInBackground(game, draft))
  })
  app.put(path('/pack-drafts/:id'), { bodyLimit: limit }, async request => {
    const { actor, admin } = await draftAccess(request)
    const { data, version } = z.object({ data: z.unknown(), version: z.number().int().positive() }).parse(request.body)
    const { rows: [draft] } = await pool.query<PackDraftRecord>(`UPDATE packs
      SET draft=$1,draft_version=draft_version+1,last_edited_by=$3
      WHERE id=$2 AND owner_id IS NOT NULL AND (owner_id=$3 OR $5) AND draft_version=$4 AND game_id=$6 AND deleted_at IS NULL RETURNING ${draftFields}`,
    [readPackDraft(game.packs, data), idOf(request), actor.id, version, admin, game.id])
    if (!draft) throw new HttpError(409, 'pack_draft_save_conflict')
    return draft
  })
  app.get(path('/pack-drafts/:id/status'), async request => {
    const { actor, admin } = await draftAccess(request)
    const { rows: [status] } = await pool.query<{ visible: boolean }>(`SELECT visible FROM packs
      WHERE id=$1 AND owner_id IS NOT NULL AND (owner_id=$2 OR $3) AND game_id=$4 AND deleted_at IS NULL`,
    [idOf(request), actor.id, admin, game.id])
    if (!status) throw new HttpError(404, 'pack_not_found')
    return status
  })
  app.delete(path('/pack-drafts/:id'), async (request, reply) => {
    const { actor, admin } = await draftAccess(request)
    const { unpublish } = z.object({ unpublish: z.literal('true').optional() }).parse(request.query)
    await transaction(async db => {
      const { rows: [status] } = await db.query<{ visible: boolean }>(`SELECT visible FROM packs
        WHERE id=$1 AND owner_id IS NOT NULL AND (owner_id=$2 OR $3) AND game_id=$4 FOR UPDATE`,
      [idOf(request), actor.id, admin, game.id])
      if (!status) throw new HttpError(404, 'pack_not_found')
      if (status.visible && !unpublish) throw new HttpError(409, 'pack_delete_requires_unpublish')
      await db.query(`UPDATE packs SET visible=false,deleted_at=now(),draft='{}'::jsonb,last_edited_by=$2
        WHERE id=$1 AND deleted_at IS NULL`, [idOf(request), actor.id])
    })
    return reply.code(204).send()
  })

  app.post(path('/pack-drafts/:id/publish'), async request => {
    const { actor, admin } = await draftAccess(request)
    const id = idOf(request)
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body)
    const where = 'id=$1 AND owner_id IS NOT NULL AND (owner_id=$2 OR $4) AND draft_version=$3 AND game_id=$5 AND deleted_at IS NULL'
    const params = [id, actor.id, version, admin, game.id]
    const { rows: [draft] } = await pool.query<PackDraftRecord>(`SELECT ${draftFields} FROM packs WHERE ${where}`, params)
    if (!draft) throw new HttpError(409, 'pack_draft_publish_conflict')
    const { rows: [published] } = await pool.query<{ data: PackDocument }>(
      'SELECT data FROM pack_revisions WHERE pack_id=$1 AND revision=$2', [id, draft.published])
    const previouslyVerified = published && draft.published
      ? game.packs.levels({ id, revision: draft.published, builtIn: false, data: published.data }) : []
    const data = await gradeInBackground(game, draft.data, previouslyVerified)
    return transaction(async db => {
      const { rows: [current] } = await db.query<PackDraftRecord & { ownerId: string }>(
        `SELECT ${draftFields},owner_id AS "ownerId" FROM packs WHERE ${where} FOR UPDATE`, params)
      if (!current) throw new HttpError(409, 'pack_draft_publish_conflict')
      const next = (current.published ?? 0) + 1
      const { rows: [old] } = await db.query<{ data: PackDocument }>(
        'SELECT data FROM pack_revisions WHERE pack_id=$1 AND revision=$2', [id, current.published])
      const pack: PackRevision = { id, revision: next, builtIn: false, data }
      const levels = assignPackLevels(pack, old && { id, revision: next - 1, builtIn: false, data: old.data }, game.packs.sameLevel)
      if (!levels) throw new HttpError(422, 'pack_level_identity_invalid')
      data.puzzles = levels
      packManifest(game.packs, data)
      if (old && (await db.query('SELECT 1 FROM pack_revisions WHERE pack_id=$1 AND revision=$2 AND data=$3',
        [id, current.published, data])).rowCount) {
        if (current.visible) return current
        return (await db.query<PackDraftRecord>(`UPDATE packs
          SET visible=true,last_edited_by=$2,draft_version=draft_version+1 WHERE id=$1 RETURNING ${draftFields}`,
        [id, actor.id])).rows[0]
      }
      await publishRevision(db, game, pack, current.ownerId)
      if (admin) request.log.info({ packId: id, actorId: actor.id, revision: next }, 'Admin published a pack update')
      return (await db.query<PackDraftRecord>(`UPDATE packs
        SET published_revision=$2,visible=true,draft=$3,last_edited_by=$4,draft_version=draft_version+1
        WHERE id=$1 RETURNING ${draftFields}`,
      [id, next, data, actor.id])).rows[0]
    })
  })
  app.patch(path('/pack-drafts/:id/visibility'), async request => {
    const { actor, admin } = await draftAccess(request)
    const { visible, version } = z.object({ visible: z.boolean(), version: z.number().int().positive().optional() }).parse(request.body)
    const { rows: [draft] } = await pool.query<PackDraftRecord>(`UPDATE packs SET visible=$1,last_edited_by=$3,
      draft_version=draft_version+CASE WHEN visible IS DISTINCT FROM $1 THEN 1 ELSE 0 END
      WHERE id=$2 AND owner_id IS NOT NULL AND (owner_id=$3 OR $4) AND published_revision IS NOT NULL AND game_id=$5
      AND deleted_at IS NULL AND ($6::integer IS NULL OR draft_version=$6) RETURNING ${draftFields}`,
    [visible, idOf(request), actor.id, admin, game.id, version ?? null])
    if (!draft) throw new HttpError(version === undefined ? 404 : 409,
      version === undefined ? 'pack_not_found' : 'pack_draft_save_conflict')
    return draft
  })

}
