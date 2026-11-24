import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium } from 'playwright'
import { validate } from '../dist/packages/sudoku/src/solver.js'
import { quickPlayVersion } from '../dist/packages/sudoku/src/contracts.js'
import { quickNonogram } from '../dist/packages/nonograms/src/contracts.js'
import { solveByDeduction } from '../dist/packages/nonograms/src/puzzles.js'

process.on('unhandledRejection', error => { console.error(error); process.exit(1) })

const origin = process.env.AVIARIUM_TEST_URL || 'http://localhost:4183'
const adminToken = process.env.AVIARIUM_TEST_ADMIN
const playerToken = process.env.AVIARIUM_TEST_PLAYER
const player2Token = process.env.AVIARIUM_TEST_PLAYER2
if (!adminToken || !playerToken || !player2Token)
  throw new Error('Set AVIARIUM_TEST_ADMIN, AVIARIUM_TEST_PLAYER and AVIARIUM_TEST_PLAYER2.')
const adminHeaders = { Cookie: 'aviarium=' + adminToken }
const playerHeaders = { Cookie: 'aviarium=' + playerToken }
const player2Headers = { Cookie: 'aviarium=' + player2Token }

async function request(path, { method = 'GET', body, headers = {}, expected = 200 } = {}) {
  const response = await fetch(origin + path, {
    method, headers: { Origin: origin, ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}: ${text}`)
  return data
}

const boardUrl = (game, key) => `/api/leaderboards/games/${game}/boards/${encodeURIComponent(key)}`

async function sudokuCompletion(headers, level, elapsedMs, quickPlay) {
  const solved = validate(Array.from(level.grid, Number))
  assert.equal(solved.kind, 'unique', 'fixture Sudoku is solvable')
  await request('/api/progress', { method: 'POST', headers, body: {
    sessionId: randomUUID(), mutationId: randomUUID(), baseRevision: 0, archived: false,
    data: { game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: level.ruleset, format: 1,
      board: { entries: solved.solution, notes: Array(81).fill(0) }, undo: [], redo: [],
      elapsedMs, completed: true, completedAt: Date.now() },
    ...(quickPlay ? { quickPlay } : {}),
  } })
}

const player = (await request('/api/me', { headers: playerHeaders })).user
const player2 = (await request('/api/me', { headers: player2Headers })).user
assert.equal(player.role, 'user')
assert.equal(player2.role, 'user')
assert.notEqual(player.id, player2.id)
assert.equal((await request('/api/me', { headers: adminHeaders })).user.role, 'admin')
console.log('permission checks passed')

const catalog = await request('/api/catalog', { headers: playerHeaders })
const afterglow = catalog.find(level => level.id === 'afterglow')
assert.ok(afterglow)
await sudokuCompletion(playerHeaders, afterglow, 300_000)
await sudokuCompletion(player2Headers, afterglow, 240_000)
let board = await request(boardUrl('sudoku', 'level:afterglow:1'), { headers: playerHeaders })
assert.equal(board.top.length, 2)
assert.equal(board.top[0].name, 'Test Player Two')
assert.equal(board.top[0].value, 240_000)
let playerRow = board.top.find(row => row.you)
assert.equal(playerRow.value, 300_000)
console.log('fixed level board passed')

// The same exact puzzle inside the cooldown is stored but hidden from the board.
await sudokuCompletion(player2Headers, afterglow, 200_000)
board = await request(boardUrl('sudoku', 'level:afterglow:1'), { headers: player2Headers })
playerRow = board.top.find(row => row.you)
assert.equal(playerRow.value, 240_000)
let adminResults = await request('/api/admin/leaderboards/results', { headers: adminHeaders })
assert.ok(adminResults.some(result => result.playerName === 'Test Player Two' &&
  result.board.key === 'level:afterglow:1' && result.status === 'cooldown' && result.value === 200_000))
console.log('per-puzzle cooldown passed')

// Once the exact-puzzle window has passed, a new completion posts again.
const db = new pg.Client({ connectionString: process.env.AVIARIUM_TEST_DATABASE_URL })
await db.connect()
await db.query(`UPDATE leaderboard_results SET recorded_at = now() - interval '31 days'
  WHERE owner_id=$1 AND board_key='level:afterglow:1'`, [player2.id])
await sudokuCompletion(player2Headers, afterglow, 210_000)
board = await request(boardUrl('sudoku', 'level:afterglow:1'), { headers: player2Headers })
playerRow = board.top.find(row => row.you)
assert.equal(playerRow.value, 210_000)
adminResults = await request('/api/admin/leaderboards/results', { headers: adminHeaders })
assert.ok(adminResults.some(result => result.playerName === 'Test Player Two' &&
  result.board.key === 'level:afterglow:1' && result.status === 'active' && result.value === 210_000))
console.log('cooldown expiry passed')

// Quick Play groups different seeds by difficulty; each result keeps its exact grid.
const quickA = await request('/api/sudoku/quick-play', { method: 'POST', headers: playerHeaders,
  body: { difficulty: 'Hard', seed: 'leaderboard-hard-a' } })
const quickB = await request('/api/sudoku/quick-play', { method: 'POST', headers: player2Headers,
  body: { difficulty: 'Hard', seed: 'leaderboard-hard-b' } })
await sudokuCompletion(playerHeaders, quickA, 120_000,
  { seed: 'leaderboard-hard-a', difficulty: 'Hard', version: quickPlayVersion })
await sudokuCompletion(player2Headers, quickB, 180_000,
  { seed: 'leaderboard-hard-b', difficulty: 'Hard', version: quickPlayVersion })
board = await request(boardUrl('sudoku', 'quick:Hard'), { headers: playerHeaders })
playerRow = board.top.find(row => row.you)
assert.equal(playerRow.value, 120_000)
assert.equal(playerRow.seedCode, 'AV2-H-leaderboard-hard-a')
assert.equal(playerRow.level.id, quickA.id)
assert.ok(board.top.some(row => !row.you && row.value === 180_000))
console.log('Quick Play difficulty board passed')

// Nonograms random boards group by size and difficulty.
let nonogram
let nonogramSolved
for (let attempt = 0; attempt < 20 && !nonogram; attempt++) {
  const descriptor = { seed: randomUUID(), size: 5, difficulty: 'Easy', version: 1 }
  nonogram = await quickNonogram(descriptor)
  if (nonogram) nonogramSolved = solveByDeduction(nonogram.content)
}
assert.ok(nonogram && nonogramSolved)
await request('/api/progress', { method: 'POST', headers: playerHeaders, body: {
  sessionId: randomUUID(), mutationId: randomUUID(), baseRevision: 0, archived: false,
  data: { game: 'nonograms', level: nonogram.id, levelRevision: 1, ruleset: 1, format: 1,
    board: nonogramSolved.cells, undo: [], elapsedMs: 90_000, completed: true, completedAt: Date.now() },
  quickPlay: { seed: nonogram.seed, size: 5, difficulty: 'Easy', version: 1 },
} })
board = await request(boardUrl('nonograms', 'quick:5:Easy'), { headers: playerHeaders })
playerRow = board.top.find(row => row.you)
assert.equal(playerRow.value, 90_000)
assert.equal(board.board.size, 5)
assert.equal(board.board.difficulty, 'Easy')
console.log('Nonograms board passed')

// Admin removal drops the best result, reveals the remaining time, and creates one notice for its owner.
const victim = adminResults.find(result => result.playerName === 'Test Player' &&
  result.board.key === 'level:afterglow:1' && result.status === 'active')
assert.ok(victim)
await request(`/api/admin/leaderboards/results/${victim.id}/remove`, { method: 'POST', headers: adminHeaders,
  body: { reason: 'Automated moderation reason' } })
board = await request(boardUrl('sudoku', 'level:afterglow:1'), { headers: player2Headers })
assert.equal(board.top.find(row => row.you).value, 210_000)
const notices = await request('/api/leaderboards/notices', { headers: playerHeaders })
assert.equal(notices.notices.length, 1)
assert.equal(notices.notices[0].reason, 'Automated moderation reason')
assert.equal(notices.notices[0].adminName, 'Test Admin')
assert.equal((await request('/api/leaderboards/notices', { headers: player2Headers })).notices.length, 0)
const removals = await request('/api/admin/leaderboards/removals', { headers: adminHeaders })
assert.ok(removals.some(removal => removal.playerName === 'Test Player' &&
  removal.reason === 'Automated moderation reason'))
console.log('moderation and notice record passed')

let browser
try {
  browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM, args: ['--no-sandbox'] })
  const pageErrors = []
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addCookies([{ name: 'aviarium', value: playerToken, url: origin }])
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(origin + '/leaderboards')
  await page.locator('.leaderboard-card').first().waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Leaderboards', exact: true }).count(), 1)
  const dialog = page.getByRole('dialog', { name: 'Result removed' })
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /Automated moderation reason/)
  await dialog.getByRole('button', { name: 'Understood' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.reload()
  await page.locator('.leaderboard-card').first().waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Leaderboard result removed' }).count(), 0)
  assert.equal((await request('/api/leaderboards/notices', { headers: playerHeaders })).notices.length, 0)

  await page.goto(origin + '/games/sudoku/leaderboards')
  await page.locator('.leaderboard-hub .leaderboard-card').first().waitFor()
  await page.goto(origin + '/games/sudoku/leaderboards/board/' + encodeURIComponent('quick:Hard'))
  await page.locator('.leaderboard-table').waitFor()
  const quickRow = page.locator('.leaderboard-table tbody tr[data-you="true"]')
  await quickRow.getByRole('button', { name: 'Play this board' }).click()
  await page.locator('.play-page').waitFor()
  assert.equal(await page.locator('.play-page .board button').count(), 81)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.waitForURL('**/leaderboards/board/**')
  await page.locator('.leaderboard-table').waitFor()

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await adminContext.addCookies([{ name: 'aviarium', value: adminToken, url: origin }])
  const adminPage = await adminContext.newPage()
  await adminPage.goto(origin + '/admin')
  await adminPage.locator('.admin-leaderboards').waitFor()
  assert.equal(await adminPage.getByRole('heading', { name: 'Leaderboards', exact: true }).count(), 1)
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  console.log('leaderboard browser checks passed')
} finally {
  if (browser) await browser.close()
  await db.end()
}
console.log('Leaderboard checks passed: boards, cooldown, moderation, notices and exact puzzle play')
