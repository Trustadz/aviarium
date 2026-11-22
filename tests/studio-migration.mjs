import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { packLevels } from '../dist/packages/sudoku/src/packs.js'
import { rules } from '../dist/packages/sudoku/src/rules.js'
import { validate } from '../dist/packages/sudoku/src/solver.js'

if (!process.env.AVIARIUM_STUDIO_TEST_DATABASE_URL) throw new Error('Provide a disposable Studio migration database.')
Object.assign(process.env, {
  DATABASE_URL: process.env.AVIARIUM_STUDIO_TEST_DATABASE_URL,
  LOGIN_ENABLED: 'true', TEST_ENVIRONMENT: 'false', PUBLIC_ORIGIN: 'http://127.0.0.1:4183',
  OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '', OIDC_CALLBACK_URL: '',
})
const { pool, transaction } = await import('../dist/apps/server/src/config.js')
const { migrate } = await import('../dist/apps/server/src/migrate.js')
const { makeApp } = await import('../dist/apps/server/src/app.js')
const migrationRoot = new URL('../apps/server/migrations/', import.meta.url)
const grid = '054003009962010730137005060006109000500074210001002983010847300000906040049531070'
let app
try {
  await transaction(async db => {
    await db.query('CREATE TABLE migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
    for (const file of (await readdir(migrationRoot)).filter(file => file.endsWith('.sql') && file < '014-').sort()) {
      await db.query(await readFile(new URL(file, migrationRoot), 'utf8'))
      await db.query('INSERT INTO migrations(name) VALUES ($1)', [file])
    }
  })
  const { rows: [{ id: owner }] } = await pool.query(
    "INSERT INTO users(issuer,subject,name,role) VALUES('fixture','legacy','Legacy editor','admin') RETURNING id")
  const visibleId = randomUUID(), hiddenId = randomUUID()
  const sessionId = randomUUID(), token = randomUUID()
  await pool.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,author_id,validation)
    VALUES ($1,6,1,'Original title',$3,'Easy','Creator',$4,'unique'),
      ($1,7,1,'Latest title',$3,'Easy','Creator',$4,'unique'),
      ($2,4,1,'Hidden title',$3,'Easy','Creator',$4,'unique')`, [visibleId, hiddenId, grid, owner])
  await pool.query('INSERT INTO hidden_levels(level_id,hidden_by) VALUES($1,$2)', [hiddenId, owner])
  const board = rules.create(Array.from(grid, Number))
  board.entries = validate(board.entries).solution
  const save = { game: 'sudoku', format: 1, ruleset: 1, level: visibleId, levelRevision: 7,
    board, undo: [], redo: [], elapsedMs: 100, completed: true }
  await pool.query('INSERT INTO saves(id,owner_id,data) VALUES($1,$2,$3)', [sessionId, owner, save])
  await pool.query('INSERT INTO completions(owner_id,level_id,level_revision) VALUES($1,$2,7)', [owner, visibleId])
  const oldMutation = {
    mutationId: randomUUID(), sessionId, baseRevision: 1,
    data: { game: save.game, level: save.level, levelRevision: save.levelRevision, ruleset: save.ruleset, format: save.format,
      board, undo: [], redo: [], elapsedMs: 100, completed: true },
    archived: false,
  }
  await pool.query('INSERT INTO sync_receipts(owner_id,id,fingerprint,result) VALUES($1,$2,$3,$4)',
    [owner, oldMutation.mutationId, createHash('sha256').update(JSON.stringify(oldMutation)).digest('hex'),
      { id: sessionId, revision: 1, data: save, archived: false }])
  await pool.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [createHash('sha256').update(token).digest('hex'), owner])
  await migrate()

  app = await makeApp()
  const headers = { cookie: 'aviarium=' + token, origin: process.env.PUBLIC_ORIGIN }
  const packs = (await app.inject({ url: '/api/packs', headers })).json()
  const recovered = packs.find(pack => pack.data.title === 'Recovered Sudoku puzzles')
  assert.deepEqual(packLevels(recovered).map(({ id, revision }) => [id, revision]), [[visibleId, 7]])
  assert.ok(!packs.some(pack => packLevels(pack).some(level => level.id === hiddenId)))
  const drafts = (await app.inject({ url: '/api/pack-drafts', headers })).json()
  assert.ok(drafts.some(draft => !draft.visible && draft.data.puzzles[0].levelId === hiddenId))
  const progress = (await app.inject({ url: '/api/progress', headers })).json()
  assert.deepEqual(progress.completions, [{ level: visibleId, revision: 7 }])
  assert.deepEqual(progress.sessions[0].data, save)
  const retried = await app.inject({ method: 'POST', url: '/api/progress', headers, payload: oldMutation })
  assert.equal(retried.statusCode, 200, retried.body)
  assert.equal(retried.json().revision, 1)
  const sharedPacks = (await app.inject({ url: '/api/games/sudoku/packs', headers })).json()
  assert.deepEqual(sharedPacks, packs)
  assert.equal((await app.inject({ url: '/api/sudoku/level/' + visibleId + '/6', headers })).statusCode, 200)
  assert.equal((await app.inject({ url: '/api/sudoku/level/' + hiddenId + '/4', headers })).statusCode, 404)
  const updated = await app.inject({ method: 'POST', url: '/api/progress', headers,
    payload: { sessionId, mutationId: randomUUID(), baseRevision: 1, archived: false, data: save } })
  assert.equal(updated.statusCode, 200, updated.body)
  console.info('Studio migration preserved old revisions, saves and completions, and kept hidden puzzles hidden.')
} finally {
  await app?.close()
  await pool.end()
}
