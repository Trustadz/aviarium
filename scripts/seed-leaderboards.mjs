#!/usr/bin/env node
/**
 * Fill a running Aviarium test instance with mock leaderboard history through
 * the public API. Users are created through the test-role endpoint (test
 * deployments only), so every result goes through the same validation and
 * leaderboard transaction as a real completion.
 *
 * Usage:
 *   AVIARIUM_TEST_URL=http://192.168.122.108:4185 npm run seed:leaderboards
 *
 * Optional:
 *   AVIARIUM_SEED_USERS=30          new mock players
 *   AVIARIUM_SEED_PER_BOARD=2       Quick Play results per board per player
 *   AVIARIUM_SEED_DAYS=45           spread completion times over the last N days
 *   AVIARIUM_SEED_RANDOM=12345      reproducible random seed
 *   AVIARIUM_TEST_COOKIE=aviarium-test=...  also post for this existing player
 *
 * Requires `npm run build` first because it imports the compiled puzzle logic.
 */
import { randomUUID } from 'node:crypto'
import { difficulties } from '../dist/packages/game-sdk/src/index.js'
import { validate } from '../dist/packages/sudoku/src/solver.js'
import { quickPlayVersion } from '../dist/packages/sudoku/src/contracts.js'
import { effectivePackRules, packLevels } from '../dist/packages/sudoku/src/packs.js'
import { nonogramLevels, quickNonogram } from '../dist/packages/nonograms/src/contracts.js'
import { randomDifficulties, randomSizes, solveByDeduction } from '../dist/packages/nonograms/src/puzzles.js'

const base = (process.env.AVIARIUM_TEST_URL ?? 'http://127.0.0.1:4185').replace(/\/$/, '')
const origin = new URL(base).origin
const userCount = positive(process.env.AVIARIUM_SEED_USERS, 30)
const perBoard = positive(process.env.AVIARIUM_SEED_PER_BOARD, 2)
const days = positive(process.env.AVIARIUM_SEED_DAYS, 45)
const maxElapsedDays = 365

let randomState = number(process.env.AVIARIUM_SEED_RANDOM, Date.now()) >>> 0
const random = () => {
  randomState = (randomState + 0x6D2B79F5) >>> 0
  let t = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function number(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positive(value, fallback) {
  return Math.max(1, Math.floor(number(value, fallback)))
}

async function api(path, { cookie, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : undefined } catch { data = undefined }
  if (response.status !== expected) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`)
  return data
}

async function createUser() {
  const response = await fetch(base + '/api/auth/test-role', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  })
  if (response.status !== 204) throw new Error('Could not create a test player: ' + response.status)
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie')
  if (!setCookie) throw new Error('The test player response did not set a session cookie.')
  const cookie = setCookie.split(';')[0]
  const me = await api('/api/me', { cookie })
  if (!me.user) throw new Error('The new test player has no session.')
  return { cookie, id: me.user.id, name: me.user.name, avatar: me.user.avatar, skill: 0.72 + random() * 0.75 }
}

const ranges = {
  Easy: [90, 360], Medium: [240, 720], Hard: [480, 1500], Extreme: [900, 2700], Genius: [1500, 3600],
}

function elapsedFor(difficulty, skill) {
  const [min, max] = ranges[difficulty] ?? ranges.Medium
  return Math.round((min + random() * (max - min)) * skill) * 1000
}

function finishedAt() {
  return Date.now() - Math.floor(random() * days * 86_400_000) - 60_000
}

function aids() {
  return { hints: random() < 0.35, autoNotes: random() < 0.5, mistakes: random() < 0.7 }
}

async function postResult(user, data, quickPlay) {
  // Test-only field: spread the visible posting dates across the seeded history.
  const seedRecordedAt = Math.min(Date.now(), Number(data.completedAt) + 60_000 + Math.floor(random() * 2 * 86_400_000))
  await api('/api/progress', { cookie: user.cookie, method: 'POST', body: {
    sessionId: randomUUID(), mutationId: randomUUID(), baseRevision: 0, archived: false, data, seedRecordedAt,
    ...(quickPlay ? { quickPlay } : {}),
  } })
}

async function postSudokuLevel(user, level, pack) {
  const solved = validate(Array.from(level.grid, Number), 65_000, level.ruleset === 2)
  if (solved.kind !== 'unique') throw new Error('Sudoku fixture has no unique solution: ' + level.id)
  const rules = pack ? effectivePackRules(pack, level.pack.stop) : undefined
  const lives = rules?.lives
  const data = {
    game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: level.ruleset, format: 1,
    board: { entries: solved.solution, notes: Array(81).fill(0) }, undo: [], redo: [],
    elapsedMs: elapsedFor(level.difficulty ?? 'Medium', user.skill), completed: true, completedAt: finishedAt(),
    aids: aids(), ...(lives !== undefined && lives !== null ? { lives } : {}), ...(pack ? { packRevision: pack.revision } : {}),
  }
  await postResult(user, data)
}

async function postQuickSudoku(user, difficulty) {
  const slug = user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const seed = `mock-${slug}-${difficulty.toLowerCase()}-${randomUUID().slice(0, 8)}`
  const level = await api('/api/sudoku/quick-play', { cookie: user.cookie, method: 'POST', body: { difficulty, seed } })
  const solved = validate(Array.from(level.grid, Number))
  if (solved.kind !== 'unique') throw new Error('Quick Play fixture has no unique solution: ' + level.id)
  const data = {
    game: 'sudoku', level: level.id, levelRevision: 1, ruleset: 1, format: 1,
    board: { entries: solved.solution, notes: Array(81).fill(0) }, undo: [], redo: [],
    elapsedMs: elapsedFor(difficulty, user.skill), completed: true, completedAt: finishedAt(), aids: aids(),
  }
  await postResult(user, data, { seed, difficulty, version: quickPlayVersion })
}

function nonogramDifficulty(level) {
  return level.difficulty ?? (level.content.rows.length <= 5 ? 'Easy' : 'Medium')
}

async function postNonogramLevel(user, level, pack, quickPlay) {
  const solved = solveByDeduction(level.content)
  if (!solved) throw new Error('Nonogram fixture does not solve by deduction: ' + level.id)
  const elapsedMs = Math.min(maxElapsedDays * 86_400_000, elapsedFor(nonogramDifficulty(level), user.skill))
  const data = {
    game: 'nonograms', level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    board: solved.cells, undo: [], elapsedMs, completed: true, completedAt: finishedAt(),
    ...(pack ? { packRevision: pack.revision } : {}),
  }
  await postResult(user, data, quickPlay)
}

async function postQuickNonogram(user, size, difficulty) {
  let level
  let descriptor
  for (let attempt = 0; attempt < 20 && !level; attempt++) {
    descriptor = { seed: randomUUID(), size, difficulty, version: 1 }
    level = await quickNonogram(descriptor)
  }
  if (!level) throw new Error('Could not generate a mock Nonogram.')
  await postNonogramLevel(user, level, undefined, descriptor)
}

const users = []
const existingCookie = process.env.AVIARIUM_TEST_COOKIE
if (existingCookie) {
  const me = await api('/api/me', { cookie: existingCookie })
  if (me.user) users.push({ cookie: existingCookie, id: me.user.id, name: me.user.name, avatar: me.user.avatar, skill: 1 })
  else console.warn('AVIARIUM_TEST_COOKIE did not resolve to a player; skipping it.')
}
for (let index = 0; index < userCount; index++) {
  const user = await createUser()
  users.push(user)
  if ((index + 1) % 5 === 0 || index + 1 === userCount)
    console.info(`Created ${index + 1}/${userCount} players (${user.name})`)
}

const first = users[0]
if (!first) throw new Error('No mock players were created.')
const catalog = await api('/api/catalog', { cookie: first.cookie })
const sudokuPacks = await api('/api/games/sudoku/packs', { cookie: first.cookie })
const nonogramPacks = await api('/api/games/nonograms/packs', { cookie: first.cookie })
const standaloneSudoku = catalog.filter(level => !level.pack)
const sudokuPackLevels = sudokuPacks.flatMap(pack => packLevels(pack).map(level => ({ level, pack })))
const nonogramPackLevels = nonogramPacks.flatMap(pack => nonogramLevels(pack).map(level => ({ level, pack })))

let posted = { sudoku: 0, nonograms: 0, failed: 0 }
async function attempt(kind, task) {
  try {
    await task()
    posted[kind]++
  } catch (error) {
    posted.failed++
    console.warn(`Skipped ${kind} result: ${error instanceof Error ? error.message : error}`)
  }
}

for (const [index, user] of users.entries()) {
  console.info(`[${index + 1}/${users.length}] ${user.name}`)
  for (const level of standaloneSudoku) await attempt('sudoku', () => postSudokuLevel(user, level))
  for (const { level, pack } of sudokuPackLevels) await attempt('sudoku', () => postSudokuLevel(user, level, pack))
  for (const difficulty of difficulties)
    for (let iteration = 0; iteration < perBoard; iteration++)
      await attempt('sudoku', () => postQuickSudoku(user, difficulty))
  for (const { level, pack } of nonogramPackLevels) await attempt('nonograms', () => postNonogramLevel(user, level, pack))
  for (const size of randomSizes)
    for (const difficulty of randomDifficulties)
      for (let iteration = 0; iteration < perBoard; iteration++)
        await attempt('nonograms', () => postQuickNonogram(user, size, difficulty))
}

console.info(`\nMock leaderboard data posted to ${base}`)
console.info(`Players: ${users.length} (${users.slice(0, 5).map(user => user.name).join(', ')}${users.length > 5 ? ', …' : ''})`)
console.info(`Results: ${posted.sudoku} Sudoku, ${posted.nonograms} Nonograms${posted.failed ? `, ${posted.failed} skipped` : ''}`)
