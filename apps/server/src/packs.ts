import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { difficultySchema } from '../../../packages/sudoku/src/contracts.js'
import { packLevels, packUploadBytes, type GradedPack, type PackDraft, type PackDraftData, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { generateQuickPuzzle, quickPlayVersion } from '../../../packages/sudoku/src/quick-play.js'
import { builtInPacks } from '../../../packages/sudoku/src/built-in-packs.js'
import { digest, HttpError, requireGameEditor, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment, transaction } from './config.js'
import { exportPack, gradePack, importPack, readPackDraft } from './pack-content.js'

const game = 'sudoku'
const draftFields = 'id,draft_version AS version,published_revision AS published,visible,draft AS data'
const packId = z.string().regex(/^[a-z0-9-]{1,64}$/)
const revision = z.coerce.number().int().positive()
const idOf = (request: FastifyRequest) => packId.parse((request.params as { id: string }).id)
const limit = Math.ceil(packUploadBytes / 3) * 4 + 256
async function player(request: FastifyRequest) {
  if (loginEnabled || testEnvironment) return requireUser(request)
}

async function publishRevision(db: PoolClient, pack: PublishedPack, owner?: string) {
  await db.query('INSERT INTO sudoku_pack_revisions(pack_id,revision,data) VALUES($1,$2,$3)',
    [pack.id, pack.revision, pack.data])
  for (const level of packLevels(pack)) {
    await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,author_id,
      seed,generator_version,validation,catalog_visible,pack) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,'unique',false,$10)`,
    [level.id, level.revision, level.title, level.grid, level.difficulty, level.source, owner,
      level.seed, level.generatorVersion, level.pack])
  }
}

export async function seedPacks(db: PoolClient) {
  for (const definition of builtInPacks) {
    const { id, revision, coverFile } = definition
    const draft = { ...definition.data }
    if (coverFile) {
      const art = await readFile(new URL('../../../../dist/web/' + coverFile, import.meta.url))
      draft.cover = 'data:image/webp;base64,' + art.toString('base64')
    }
    if ((await db.query('SELECT 1 FROM sudoku_pack_revisions WHERE pack_id=$1 AND revision=$2', [id, revision])).rowCount) {
      // Replacing bundled cover art leaves the puzzle revision and existing progress pinned.
      if (draft.cover) {
        await db.query(`UPDATE sudoku_pack_revisions r SET data=jsonb_set(r.data,'{cover}',to_jsonb($3::text))
          FROM sudoku_packs p WHERE p.id=r.pack_id AND p.owner_id IS NULL AND r.pack_id=$1 AND r.revision=$2
          AND r.data->>'cover' IS DISTINCT FROM $3`, [id, revision, draft.cover])
        await db.query(`UPDATE sudoku_packs SET draft=jsonb_set(draft,'{cover}',to_jsonb($3::text))
          WHERE id=$1 AND owner_id IS NULL AND published_revision=$2 AND draft->>'cover' IS DISTINCT FROM $3`,
        [id, revision, draft.cover])
      }
      continue
    }
    const data = gradePack(readPackDraft(draft))
    await db.query(`INSERT INTO sudoku_packs(id,draft,published_revision) VALUES($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET draft=excluded.draft,published_revision=excluded.published_revision
      WHERE sudoku_packs.owner_id IS NULL AND sudoku_packs.published_revision < excluded.published_revision`, [id, data, revision])
    await publishRevision(db, { id, revision, builtIn: true, data })
  }
}

export function registerPacks(app: FastifyInstance) {
  app.get('/api/packs', async request => {
    await player(request)
    return (await pool.query<PublishedPack>(`SELECT p.id,r.revision,p.owner_id IS NULL AS "builtIn",r.data
      FROM sudoku_packs p JOIN sudoku_pack_revisions r ON r.pack_id=p.id AND r.revision=p.published_revision
      WHERE p.visible ORDER BY p.owner_id IS NOT NULL,r.data->>'title',p.id`)).rows
  })
  async function loadPack(request: FastifyRequest) {
    const id = idOf(request)
    const rev = revision.parse((request.params as { revision: string }).revision)
    const { rows: [pack] } = await pool.query<PublishedPack & { ownerId: string | null }>(`SELECT p.id,r.revision,
      p.owner_id IS NULL AS "builtIn",p.owner_id AS "ownerId",r.data
      FROM sudoku_packs p JOIN sudoku_pack_revisions r ON r.pack_id=p.id WHERE p.id=$1 AND r.revision=$2`, [id, rev])
    if (!pack) throw new HttpError(404, 'pack_revision_unavailable')
    return pack
  }
  app.get('/api/packs/:id/:revision', async request => {
    const user = await player(request)
    const { ownerId, ...pack } = await loadPack(request)
    return { ...pack, ownedByViewer: Boolean(user && user.id === ownerId) }
  })
  app.get('/api/packs/:id/:revision/export', async (request, reply) => {
    const user = await requireGameEditor(request, game)
    const pack = await loadPack(request)
    if (user.role !== 'admin' && pack.ownerId !== user.id)
      throw new HttpError(403, 'pack_export_denied')
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${pack.id}.aviarium-pack"`)
      .send(exportPack(pack.data))
  })

  async function newDraft(owner: string, data: PackDraftData) {
    return (await pool.query<PackDraft>(`INSERT INTO sudoku_packs(id,owner_id,draft) VALUES($1,$2,$3)
      RETURNING ${draftFields}`, [randomUUID(), owner, data])).rows[0]
  }
  app.get('/api/pack-drafts', async request => {
    const user = await requireGameEditor(request, game)
    return (await pool.query<PackDraft>(`SELECT ${draftFields} FROM sudoku_packs WHERE owner_id=$1
      ORDER BY draft->>'title',id`, [user.id])).rows
  })
  app.post('/api/pack-drafts', { bodyLimit: limit }, async request => {
    const user = await requireGameEditor(request, game)
    return newDraft(user.id, readPackDraft(request.body))
  })
  app.post('/api/pack-drafts/import', { bodyLimit: limit }, async request => {
    const user = await requireGameEditor(request, game)
    const { content } = z.object({ content: z.string().max(limit).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).parse(request.body)
    const draft = importPack(Buffer.from(content, 'base64'))
    // Diagnose incompatible or ungradable puzzles before saving an imported draft.
    const checked = gradePack(draft)
    return newDraft(user.id, checked)
  })
  app.put('/api/pack-drafts/:id', { bodyLimit: limit }, async request => {
    const user = await requireGameEditor(request, game)
    const { data, version } = z.object({ data: z.unknown(), version: z.number().int().positive() }).parse(request.body)
    const { rows: [draft] } = await pool.query<PackDraft>(`UPDATE sudoku_packs SET draft=$1,draft_version=draft_version+1
      WHERE id=$2 AND owner_id=$3 AND draft_version=$4 RETURNING ${draftFields}`,
    [readPackDraft(data), idOf(request), user.id, version])
    if (!draft) throw new HttpError(409, 'pack_draft_save_conflict')
    return draft
  })
  app.post('/api/pack-drafts/:id/publish', async request => {
    const user = await requireGameEditor(request, game)
    const id = idOf(request)
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body)
    const { rows: [draft] } = await pool.query<PackDraft>(`SELECT ${draftFields} FROM sudoku_packs
      WHERE id=$1 AND owner_id=$2 AND draft_version=$3`, [id, user.id, version])
    if (!draft) throw new HttpError(409, 'pack_draft_publish_conflict')
    const data = gradePack(draft.data)
    return transaction(async db => {
      const { rows: [current] } = await db.query<PackDraft>(`SELECT ${draftFields} FROM sudoku_packs
        WHERE id=$1 AND owner_id=$2 AND draft_version=$3 FOR UPDATE`, [id, user.id, version])
      if (!current) throw new HttpError(409, 'pack_draft_publish_conflict')
      if (current.published) {
        const equal = (await db.query(`SELECT 1 FROM sudoku_pack_revisions WHERE pack_id=$1 AND revision=$2 AND data=$3`,
          [id, current.published, data])).rowCount
        if (equal) {
          if (!current.visible) await db.query('UPDATE sudoku_packs SET visible=true WHERE id=$1', [id])
          return { ...current, visible: true }
        }
      }
      const next = (current.published ?? 0) + 1
      await publishRevision(db, { id, revision: next, builtIn: false, data }, user.id)
      return (await db.query<PackDraft>(`UPDATE sudoku_packs SET published_revision=$2,visible=true
        WHERE id=$1 RETURNING ${draftFields}`, [id, next])).rows[0]
    })
  })
  app.patch('/api/pack-drafts/:id/visibility', async request => {
    const user = await requireGameEditor(request, game)
    const { visible } = z.object({ visible: z.boolean() }).parse(request.body)
    const { rows: [draft] } = await pool.query<PackDraft>(`UPDATE sudoku_packs SET visible=$1
      WHERE id=$2 AND owner_id=$3 AND published_revision IS NOT NULL RETURNING ${draftFields}`, [visible, idOf(request), user.id])
    if (!draft) throw new HttpError(404, 'pack_not_found')
    return draft
  })

  app.post('/api/sudoku/quick-play', async request => {
    await player(request)
    const input = z.object({ difficulty: difficultySchema, seed: z.string().trim().min(1).max(100).optional(),
      version: z.literal(quickPlayVersion).optional() }).parse(request.body)
    const seed = input.seed ?? randomBytes(8).toString('hex')
    const id = 'quick-' + digest(JSON.stringify([quickPlayVersion, input.difficulty, seed])).slice(0, 36)
    const fields = 'id,revision,ruleset,title,grid,difficulty,source,seed,generator_version AS "generatorVersion"'
    const existing = (await pool.query<PublishedLevel>(`SELECT ${fields} FROM published_levels WHERE id=$1 AND revision=1`, [id])).rows[0]
    if (existing) return existing
    const grid = generateQuickPuzzle(seed, input.difficulty)
    await pool.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,seed,generator_version,
      validation,catalog_visible) VALUES($1,1,1,'Quick Play',$2,$3,'Generated',$4,$5,'unique',false) ON CONFLICT DO NOTHING`,
    [id, grid, input.difficulty, seed, quickPlayVersion])
    return (await pool.query<PublishedLevel>(`SELECT ${fields} FROM published_levels WHERE id=$1 AND revision=1`, [id])).rows[0]
  })
  app.get('/api/sudoku/level/:id/:revision', async request => {
    await player(request)
    const rev = revision.parse((request.params as { revision: string }).revision)
    const { rows: [level] } = await pool.query<PublishedLevel>(`SELECT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,
      l.source,l.seed,l.generator_version AS "generatorVersion" FROM published_levels l
      WHERE l.id=$1 AND l.revision=$2 AND l.catalog_visible
        AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)`, [idOf(request), rev])
    if (!level) throw new HttpError(404, 'puzzle_revision_unavailable')
    return level
  })
}
