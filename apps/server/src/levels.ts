import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { generationSchema, gridSchema } from '../../../packages/sudoku/src/contracts.js'
import { HttpError, requireEditor } from './auth.js'
import { pool, transaction } from './config.js'

interface Draft { id: string; owner_id: string; title: string; grid: string; version: number; seed: string | null }
const draftInput = z.object({ title: z.string().trim().min(1).max(100), grid: gridSchema, generationJob: z.uuid().optional() })
const recordId = (request: FastifyRequest) => z.uuid().parse((request.params as { id: string }).id)
const jobColumns = 'id, kind, status, result, draft_id AS "draftId", draft_version AS "draftVersion"'

export function registerLevels(app: FastifyInstance) {
  app.get('/api/drafts', async request => {
    const user = await requireEditor(request)
    return (await pool.query('SELECT id,title,grid,version,seed FROM drafts WHERE owner_id=$1 ORDER BY updated_at DESC', [user.id])).rows
  })
  app.post('/api/drafts', async request => {
    const user = await requireEditor(request)
    const input = draftInput.parse(request.body)
    const metadata = await generation(user.id, input)
    return (await pool.query<Draft>(`INSERT INTO drafts(owner_id,title,grid,seed,generator_version)
      VALUES($1,$2,$3,$4,$5) RETURNING id,title,grid,version,seed`,
    [user.id, input.title, input.grid, metadata?.seed, metadata?.generatorVersion])).rows[0]
  })
  app.put('/api/drafts/:id', async request => {
    const user = await requireEditor(request)
    const input = draftInput.extend({ version: z.number().int().positive() }).parse(request.body)
    const metadata = await generation(user.id, input)
    const result = await pool.query(`UPDATE drafts SET title=$1,grid=$2,version=version+1,updated_at=now(),
      seed=CASE WHEN $4::text IS NOT NULL THEN $4 WHEN grid=$2 THEN seed END,
      generator_version=CASE WHEN $5::int IS NOT NULL THEN $5 WHEN grid=$2 THEN generator_version END
      WHERE id=$6 AND owner_id=$7 AND version=$3 RETURNING id,title,grid,version,seed`,
    [input.title, input.grid, input.version, metadata?.seed, metadata?.generatorVersion, recordId(request), user.id])
    if (!result.rowCount) throw new HttpError(409, 'draft_save_conflict')
    return result.rows[0]
  })
  app.get('/api/jobs', async request => {
    const user = await requireEditor(request)
    return (await pool.query(`SELECT ${jobColumns} FROM puzzle_jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30`, [user.id])).rows
  })
  app.post('/api/jobs', async request => {
    const user = await requireEditor(request)
    const input = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('validate'), draftId: z.uuid(), version: z.number().int().positive() }),
      z.object({ kind: z.literal('generate'), options: generationSchema }),
    ]).parse(request.body)
    return transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
      const { rows: [count] } = await db.query(`SELECT count(*)::int AS total FROM puzzle_jobs
        WHERE owner_id=$1 AND status IN ('queued','running')`, [user.id])
      if (count.total >= 8) throw new HttpError(429, 'job_limit')
      let payload: object
      if (input.kind === 'validate') {
        const draft = (await db.query<Draft>('SELECT * FROM drafts WHERE id=$1 AND owner_id=$2 AND version=$3',
          [input.draftId, user.id, input.version])).rows[0]
        if (!draft) throw new HttpError(409, 'draft_test_conflict')
        payload = { grid: draft.grid }
      } else payload = input.options
      const result = await db.query(`INSERT INTO puzzle_jobs(owner_id,kind,input,draft_id,draft_version)
        VALUES($1,$2,$3,$4,$5) RETURNING ${jobColumns}`, [user.id, input.kind, payload,
        input.kind === 'validate' ? input.draftId : null, input.kind === 'validate' ? input.version : null])
      return result.rows[0]
    })
  })
  app.post('/api/drafts/:id/publish', async request => {
    await requireEditor(request)
    throw new HttpError(409, 'draft_needs_pack')
  })
}

async function generation(owner: string, input: z.infer<typeof draftInput>) {
  if (!input.generationJob) return undefined
  const { rows: [job] } = await pool.query(`SELECT result FROM puzzle_jobs WHERE id=$1 AND owner_id=$2
    AND kind='generate' AND status='complete'`, [input.generationJob, owner])
  if (job?.result?.grid !== input.grid) throw new HttpError(400, 'draft_generated_grid_changed')
  return job.result as { seed: string; generatorVersion: number }
}
