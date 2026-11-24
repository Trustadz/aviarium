import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { chromium } from 'playwright'
import { validate } from '../dist/packages/sudoku/src/solver.js'

process.on('unhandledRejection', error => { console.error(error); process.exit(1) })

const database = process.env.AVIARIUM_CHALLENGE_TEST_DATABASE_URL
if (!database) throw new Error('Set AVIARIUM_CHALLENGE_TEST_DATABASE_URL.')
const port = '4184'
const origin = 'http://127.0.0.1:' + port
const app = spawn(process.execPath, ['dist/apps/server/src/app.js'], {
  env: { ...process.env, DATABASE_URL: database, HOST: '127.0.0.1', PORT: port, PUBLIC_ORIGIN: origin,
    TEST_ENVIRONMENT: 'true', LOGIN_ENABLED: 'false', CHALLENGES_ENABLED: 'true', CHALLENGE_TIMEZONE: 'UTC' },
  stdio: 'inherit',
})
const digest = value => createHash('sha256').update(value).digest('hex')
const token1 = randomUUID()
const token2 = randomUUID()
const headers1 = { Cookie: 'aviarium-test=' + token1 }
const headers2 = { Cookie: 'aviarium-test=' + token2 }
const clock = { day: '2026-11-24T12:00:00.000Z', late: '2026-11-24T23:59:00.000Z',
  after: '2026-11-25T00:01:00.000Z' }

async function request(path, { method = 'GET', body, headers = {}, expected = 200, now } = {}) {
  const response = await fetch(origin + path, {
    method, headers: { Origin: origin, ...headers, ...(now ? { 'X-Aviarium-Test-Now': now } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}: ${text}`)
  return data
}

function solve(level) {
  const result = validate(Array.from(level.grid, Number))
  assert.equal(result.kind, 'unique', 'challenge Sudoku has a unique solution')
  return result.solution
}

function completion(start, solution, elapsedMs, now) {
  return {
    sessionId: start.sessionId, mutationId: randomUUID(), baseRevision: 0, archived: false,
    updatedAt: Date.parse(now),
    data: {
      game: 'sudoku', level: start.slot.level.id, levelRevision: start.slot.level.revision,
      ruleset: start.slot.level.ruleset, format: 1,
      board: { entries: solution, notes: Array(81).fill(0) }, undo: [], redo: [],
      elapsedMs, completed: true, completedAt: Date.parse(now),
    },
    challenge: { attemptId: start.attemptId },
  }
}

let browser
try {
  for (let attempt = 0; ; attempt++) {
    if ((await fetch(origin + '/health/ready').catch(() => undefined))?.ok) break
    if (app.exitCode !== null || app.signalCode !== null || attempt >= 60)
      throw new Error('The challenge test server did not start.')
    await delay(200)
  }
  const db = new pg.Client({ connectionString: database })
  await db.connect()
  try {
    await db.query(`UPDATE challenge_series SET enabled=true, game_limit=2, reset_minute=0, timezone='UTC',
      game_options=$1::jsonb WHERE id='daily'`, [JSON.stringify({
        sudoku: { difficulty: ['Medium'] },
        nonograms: { size: ['10'], difficulty: ['Easy', 'Medium', 'Hard'] },
      })])
    for (const [role, name, token] of [['admin', 'Challenge Admin', token1], ['user', 'Challenge Player', token2]]) {
      const { rows: [user] } = await db.query(
        "INSERT INTO users(issuer,subject,name,role) VALUES ('aviarium:test',$1,$2,$3) RETURNING id", [token, name, role])
      await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
        [digest(token), user.id])
    }

    const settings = await request('/api/admin/challenges/settings', { headers: headers1, now: clock.day })
    assert.equal(settings.enabled, true)
    assert.equal(settings.gameLimit, 2)

    const day = await request('/api/challenges', { headers: headers1, now: clock.day })
    assert.ok(day.occurrence, 'today has an occurrence')
    assert.equal(day.slots.length, 2)
    assert.deepEqual(day.slots.map(slot => slot.game).sort(), ['nonograms', 'sudoku'])
    const sudoku = day.slots.find(slot => slot.game === 'sudoku')
    const nonograms = day.slots.find(slot => slot.game === 'nonograms')
    assert.ok(sudoku && nonograms)
    assert.equal(sudoku.player.status, 'available')

    const start = await request('/api/challenges/slots/' + sudoku.id + '/start',
      { method: 'POST', headers: headers1, body: {}, now: clock.day })
    assert.equal(start.resumed, false)
    const solution = solve(start.slot.level)
    const done = await request('/api/progress', {
      method: 'POST', headers: headers1, now: clock.day, body: completion(start, solution, 1500, clock.day),
    })
    assert.equal(done.challenge.status, 'completed')
    assert.equal(done.challenge.ranked, true)
    await request('/api/challenges/slots/' + sudoku.id + '/start',
      { method: 'POST', headers: headers1, body: {}, now: clock.day, expected: 409 })

    const board = await request('/api/challenges/' + day.occurrence.id + '/slots/sudoku/board',
      { headers: headers1, now: clock.day })
    assert.equal(board.board.kind, 'challenge')
    assert.equal(board.total, 1)
    assert.equal(board.you.rank, 1)
    assert.ok(board.you.value >= 1500, 'the server time is a floor')

    const lateStart = await request('/api/challenges/slots/' + sudoku.id + '/start',
      { method: 'POST', headers: headers2, body: {}, now: clock.late })
    const lateSolution = solve(lateStart.slot.level)
    const late = await request('/api/progress', {
      method: 'POST', headers: headers2, now: clock.after,
      body: completion(lateStart, lateSolution, 1000, clock.after),
    })
    assert.equal(late.challenge.status, 'closed')
    assert.equal(late.challenge.ranked, false)
    const lateBoard = await request('/api/challenges/' + day.occurrence.id + '/slots/sudoku/board',
      { headers: headers1, now: clock.after })
    assert.equal(lateBoard.total, 1, 'a late completion is saved but not posted')

    const history = await request('/api/challenges/history', { headers: headers1, now: clock.after })
    const closed = history.occurrences.find(item => item.occurrence.id === day.occurrence.id)
    assert.ok(closed, 'closed day appears in history')
    const closedSudoku = closed.slots.find(slot => slot.game === 'sudoku')
    assert.equal(closedSudoku.player.status, 'completed')
    assert.equal(closedSudoku.replay.game, 'sudoku')
    const next = await request('/api/challenges', { headers: headers1, now: clock.after })
    assert.notEqual(next.occurrence?.id, day.occurrence.id)
    assert.equal(next.slots.length, 2)

    browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM })
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { 'X-Aviarium-Test-Now': clock.day } })
    await context.addCookies([{ name: 'aviarium-test', value: token1, url: origin }])
    const page = await context.newPage()
    await page.goto(origin + '/challenges', { waitUntil: 'networkidle' })
    await page.locator('.challenge-slot').first().waitFor()
    assert.equal(await page.locator('.challenge-slot').count(), 2)
    await page.locator('.nav-badge').first().waitFor()
    assert.equal((await page.locator('.nav-badge').first().innerText()).trim(), '1')
    await page.screenshot({ path: '/home/tristan/projects/Aviarium/.tmp-challenges/challenges-smoke.png', fullPage: true })
  } finally {
    await db.end()
  }
} finally {
  if (browser) await browser.close()
  if (app.exitCode === null && app.signalCode === null) {
    const exited = once(app, 'exit')
    app.kill('SIGTERM')
    await exited
  }
}
console.log('Challenge lifecycle checks passed: two slots, one attempt, server time, late close, history, replay and badge.')
