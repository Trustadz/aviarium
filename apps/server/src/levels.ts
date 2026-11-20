import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { generationSchema, gridSchema } from '../../../packages/sudoku/src/contracts.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { HttpError, requireGameEditor, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment, transaction } from './config.js'

interface Draft { id: string; owner_id: string; title: string; grid: string; version: number; seed: string | null }
const draftInput = z.object({ title: z.string().trim().min(1).max(100), grid: gridSchema, generationJob: z.uuid().optional() })
const recordId = (request: FastifyRequest) => z.uuid().parse((request.params as { id: string }).id)
const latestLevels = '(SELECT DISTINCT ON (id) * FROM published_levels ORDER BY id,revision DESC)'
const jobColumns = 'id, kind, status, result, draft_id AS "draftId", draft_version AS "draftVersion"'

export function registerLevels(app: FastifyInstance) {
  app.get('/api/catalog', async request => {
    if (loginEnabled || testEnvironment) await requireUser(request)
    const result = await pool.query(`SELECT id,revision,ruleset,title,grid,difficulty,source,seed,generator_version AS "generatorVersion" FROM
      ${latestLevels} latest WHERE catalog_visible AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=latest.id)
      ORDER BY CASE id WHEN 'first-light' THEN 0 WHEN 'quiet-current' THEN 1 WHEN 'afterglow' THEN 2 ELSE 3 END,
      published_at,id`)
    return result.rows
  })
  app.get('/api/admin/levels', async request => {
    await requireUser(request, 'admin')
    return (await pool.query(`SELECT l.id,l.revision,l.title,l.source,h.level_id IS NOT NULL AS hidden
      FROM ${latestLevels} l LEFT JOIN hidden_levels h ON h.level_id=l.id
      WHERE l.source <> 'Built-in' AND l.catalog_visible ORDER BY l.published_at DESC,l.id`)).rows
  })
  app.patch('/api/admin/levels/:id', async request => {
    const user = await requireUser(request, 'admin')
    const id = recordId(request)
    const { hidden } = z.object({ hidden: z.boolean() }).parse(request.body)
    const result = await pool.query(`SELECT 1 FROM published_levels WHERE id=$1 AND source <> 'Built-in' LIMIT 1`, [id])
    if (!result.rowCount) throw new HttpError(404, 'Published level was not found.')
    if (hidden) await pool.query('INSERT INTO hidden_levels(level_id,hidden_by) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, user.id])
    else await pool.query('DELETE FROM hidden_levels WHERE level_id=$1', [id])
    return { hidden }
  })
  app.get('/api/drafts', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    return (await pool.query('SELECT id,title,grid,version,seed FROM drafts WHERE owner_id=$1 ORDER BY updated_at DESC', [user.id])).rows
  })
  app.post('/api/drafts', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    const input = draftInput.parse(request.body)
    const metadata = await generation(user.id, input)
    return (await pool.query<Draft>(`INSERT INTO drafts(owner_id,title,grid,seed,generator_version)
      VALUES($1,$2,$3,$4,$5) RETURNING id,title,grid,version,seed`,
    [user.id, input.title, input.grid, metadata?.seed, metadata?.generatorVersion])).rows[0]
  })
  app.put('/api/drafts/:id', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    const input = draftInput.extend({ version: z.number().int().positive() }).parse(request.body)
    const metadata = await generation(user.id, input)
    const result = await pool.query(`UPDATE drafts SET title=$1,grid=$2,version=version+1,updated_at=now(),
      seed=CASE WHEN $4::text IS NOT NULL THEN $4 WHEN grid=$2 THEN seed END,
      generator_version=CASE WHEN $5::int IS NOT NULL THEN $5 WHEN grid=$2 THEN generator_version END
      WHERE id=$6 AND owner_id=$7 AND version=$3 RETURNING id,title,grid,version,seed`,
    [input.title, input.grid, input.version, metadata?.seed, metadata?.generatorVersion, recordId(request), user.id])
    if (!result.rowCount) throw new HttpError(409, 'Draft changed or is unavailable. Reopen it before saving.')
    return result.rows[0]
  })
  app.get('/api/jobs', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    return (await pool.query(`SELECT ${jobColumns} FROM puzzle_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30`, [user.id])).rows
  })
  app.post('/api/jobs', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    const input = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('validate'), draftId: z.uuid(), version: z.number().int().positive() }),
      z.object({ kind: z.literal('generate'), options: generationSchema }),
    ]).parse(request.body)
    return transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
      const { rows: [count] } = await db.query(`SELECT count(*)::int AS total FROM puzzle_jobs
        WHERE owner_id=$1 AND status IN ('queued','running')`, [user.id])
      if (count.total >= 8) throw new HttpError(429, 'Wait for an existing puzzle job to finish.')
      let payload: object
      if (input.kind === 'validate') {
        const draft = (await db.query<Draft>('SELECT * FROM drafts WHERE id=$1 AND owner_id=$2 AND version=$3',
          [input.draftId, user.id, input.version])).rows[0]
        if (!draft) throw new HttpError(409, 'Save and reopen the current draft before testing.')
        payload = { grid: draft.grid }
      } else payload = input.options
      const result = await db.query(`INSERT INTO puzzle_jobs(owner_id,kind,input,draft_id,draft_version)
        VALUES($1,$2,$3,$4,$5) RETURNING ${jobColumns}`, [user.id, input.kind, payload,
        input.kind === 'validate' ? input.draftId : null, input.kind === 'validate' ? input.version : null])
      return result.rows[0]
    })
  })
  app.post('/api/drafts/:id/publish', async request => {
    const user = await requireGameEditor(request, sudoku.id)
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.body)
    const id = recordId(request)
    return transaction(async db => {
      const draft = (await db.query<Draft>('SELECT * FROM drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, user.id])).rows[0]
      if (!draft) throw new HttpError(404, 'Draft was not found.')
      const job = (await db.query(`SELECT result FROM puzzle_jobs WHERE id=$1 AND owner_id=$2 AND draft_id=$3
        AND draft_version=$4 AND kind='validate' AND status='complete'`, [jobId, user.id, id, draft.version])).rows[0]
      const result = job?.result
      if (!result?.difficulty || (result.kind !== 'unique' && result.kind !== 'multiple'))
        throw new HttpError(409, 'This exact draft needs a complete logical solve before publication.')
      const previous = (await db.query(`SELECT revision,title,grid,seed FROM published_levels WHERE id=$1
        ORDER BY revision DESC LIMIT 1`, [id])).rows[0]
      if (previous?.title === draft.title && previous.grid === draft.grid && previous.seed === draft.seed)
        return { id, revision: previous.revision }
      const revision = (previous?.revision ?? 0) + 1
      await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,
        author_id,seed,generator_version,validation)
        SELECT id::text,$2,1,title,grid,$3,$4,owner_id,seed,generator_version,$5 FROM drafts WHERE id=$1`,
      [id, revision, result.difficulty, draft.seed ? 'Generated' : 'Creator', result.kind])
      return { id, revision }
    })
  })
}

async function generation(owner: string, input: z.infer<typeof draftInput>) {
  if (!input.generationJob) return undefined
  const { rows: [job] } = await pool.query(`SELECT result FROM puzzle_jobs WHERE id=$1 AND owner_id=$2
    AND kind='generate' AND status='complete'`, [input.generationJob, owner])
  if (job?.result?.grid !== input.grid) throw new HttpError(400, 'The grid differs from the generation result.')
  return job.result as { seed: string; generatorVersion: number }
}
