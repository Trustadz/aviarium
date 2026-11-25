import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'

process.on('unhandledRejection', error => { console.error(error); process.exit(1) })

const database = process.env.AVIARIUM_PLATFORM_TEST_DATABASE_URL
if (!database) throw new Error('Set AVIARIUM_PLATFORM_TEST_DATABASE_URL.')
const port = process.env.AVIARIUM_PLATFORM_TEST_PORT || '4186'
const origin = 'http://127.0.0.1:' + port
process.env.DATABASE_URL = database
process.env.HOST = '127.0.0.1'
process.env.PORT = port
process.env.PUBLIC_ORIGIN = origin
process.env.LOGIN_ENABLED = 'true'
process.env.TEST_ENVIRONMENT = 'false'
process.env.CHALLENGES_ENABLED = 'true'
process.env.CHALLENGE_TIMEZONE = 'UTC'

const { migrate } = await import('../dist/apps/server/src/migrate.js')
const { makeApp } = await import('../dist/apps/server/src/app.js')
const { createGameRegistry } = await import('../dist/apps/server/src/game-registry.js')
const { pool } = await import('../dist/apps/server/src/config.js')
const { sudokuGame } = await import('../dist/packages/sudoku/src/game.js')
const { fixtureGame } = await import('../dist/packages/game-fixture/src/index.js')

const digest = value => createHash('sha256').update(value).digest('hex')
const token = randomUUID()
const headers = { Cookie: 'aviarium=' + token, Origin: origin }
let app
let db

async function request(path, { method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(origin + path, {
    method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}: ${text}`)
  return data
}

try {
  await migrate()
  app = await makeApp(createGameRegistry([sudokuGame, fixtureGame]))
  await app.listen({ host: '127.0.0.1', port: Number(port) })
  db = new pg.Client({ connectionString: database })
  await db.connect()
  const { rows: [user] } = await db.query(
    "INSERT INTO users(issuer,subject,name,role) VALUES ('platform-fixture',$1,'Platform Fixture','user') RETURNING id",
    [token])
  await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
    [digest(token), user.id])
  await db.query(`UPDATE challenge_series SET enabled=true, game_limit=1, eligible_games='{"fixture"}'::text[],
    game_options='{"fixture":{"difficulty":["normal"]}}'::jsonb, reset_minute=0, timezone='UTC' WHERE id='daily'`)

  const quick = await request('/api/games/fixture/quick-play', { method: 'POST',
    body: { difficulty: 'normal', seed: 'fixture-smoke' } })
  assert.equal(quick.id, 'fixture-fixture-smoke')
  assert.equal(quick.source, 'Generated')
  await request('/api/progress', { method: 'POST', body: {
    sessionId: randomUUID(), mutationId: randomUUID(), baseRevision: 0, archived: false, updatedAt: Date.now(),
    data: { game: 'fixture', level: quick.id, levelRevision: quick.revision, ruleset: quick.ruleset, format: 1,
      elapsedMs: 1234, completed: true },
  } })
  const board = await request('/api/leaderboards/games/fixture/boards/' + encodeURIComponent('level:' + quick.id + ':1'))
  assert.equal(board.total, 1)
  assert.equal(board.you.value, 1234)

  const day = await request('/api/challenges')
  assert.ok(day.occurrence)
  assert.deepEqual(day.slots.map(slot => slot.game), ['fixture'])
  const slot = day.slots[0]
  const start = await request('/api/challenges/slots/' + slot.id + '/start', { method: 'POST', body: {} })
  assert.equal(start.slot.game, 'fixture')
  const completed = await request('/api/progress', { method: 'POST', body: {
    sessionId: start.sessionId, mutationId: randomUUID(), baseRevision: 0, archived: false, updatedAt: Date.now(),
    data: { game: 'fixture', level: start.slot.level.id, levelRevision: start.slot.level.revision,
      ruleset: start.slot.level.ruleset, format: 1, elapsedMs: 500, completed: true },
    challenge: { attemptId: start.attemptId },
  } })
  assert.equal(completed.challenge.status, 'completed')
  assert.equal(completed.challenge.ranked, true)
  const challengeBoard = await request('/api/challenges/' + day.occurrence.id + '/slots/fixture/board')
  assert.equal(challengeBoard.board.kind, 'challenge')
  assert.equal(challengeBoard.you.rank, 1)
  console.log('Platform fixture checks passed: third-game quick-play, save, leaderboard, challenge slot and challenge board.')
} finally {
  if (db) await db.end().catch(() => undefined)
  if (app) await app.close().catch(() => undefined)
  await pool.end().catch(() => undefined)
}
