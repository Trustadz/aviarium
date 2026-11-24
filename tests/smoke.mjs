import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { generateQuickPuzzle, quickPlayVersion } from '../dist/packages/sudoku/src/quick-play.js'
import { formatSeedCode, quickPlayId } from '../dist/packages/sudoku/src/seed-code.js'
import { validate } from '../dist/packages/sudoku/src/solver.js'
import { rules } from '../dist/packages/sudoku/src/rules.js'
import { createNonogramAttempt, nonogramLevels } from '../dist/packages/nonograms/src/contracts.js'
import { solveByDeduction } from '../dist/packages/nonograms/src/puzzles.js'
import { packLevels, packProgress } from '../dist/packages/sudoku/src/packs.js'

const origin = process.env.AVIARIUM_TEST_URL || 'http://localhost:4183'
const adminToken = process.env.AVIARIUM_TEST_ADMIN
const playerToken = process.env.AVIARIUM_TEST_PLAYER
const adminHeaders = adminToken ? { Cookie: 'aviarium=' + adminToken } : {}
const playerHeaders = playerToken ? { Cookie: 'aviarium=' + playerToken } : {}

async function openSettings(page, name) {
  const account = page.getByRole('button', { name: 'Account menu' })
  if (await account.isVisible()) await account.click()
  await page.getByRole('button', { name, exact: true }).click()
}

async function request(path, { method = 'GET', body, headers = {}, expected = 200 } = {}) {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, ...headers,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json()
  assert.equal(response.status, expected, path + ' returned ' + JSON.stringify(data))
  return data
}
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Timed out waiting for ' + label)
}
const playbackToken = playerToken || adminToken
if (!playbackToken) throw new Error('Set AVIARIUM_TEST_PLAYER or AVIARIUM_TEST_ADMIN to a test session cookie.')
await request('/api/catalog', { expected: 401 })
await request('/api/progress', { expected: 401 })
const starting = await request('/api/catalog', { headers: playerToken ? playerHeaders : adminHeaders })
assert.ok(starting.some(level => level.id === 'first-light'))
assert.equal((await request('/health/ready')).status, 'ok')
await request('/api/drafts', { expected: 401 })
const selected = starting.find(level => level.id === 'first-light')
const level = Array.from(selected.grid, Number)
const solution = validate(level).solution
assert.ok(solution)
const updatedTitle = 'Smoke check ' + crypto.randomUUID().slice(0, 8)
const feedHeaders = playerToken ? playerHeaders : adminHeaders
const englishLaunch = (await request('/api/news?locale=en', { headers: feedHeaders })).posts
  .filter(post => post.title === 'Nonograms joins the library')
const dutchLaunch = (await request('/api/news?locale=nl', { headers: feedHeaders })).posts
  .filter(post => post.title === 'Nonogrammen in de bibliotheek')
assert.equal(englishLaunch.length, 1)
assert.equal(dutchLaunch.length, 1)
assert.equal(englishLaunch[0].id, dutchLaunch[0].id)
assert.equal(englishLaunch[0].category, 'game')
assert.equal(englishLaunch[0].hasHeaderImage, true)
assert.equal(dutchLaunch[0].hasHeaderImage, true)
assert.match(englishLaunch[0].headerAlt, /cockatoo in flight/)
assert.match(dutchLaunch[0].headerAlt, /kaketoe vliegt/)
const launchBanner = await fetch(origin + '/api/news/' + englishLaunch[0].id + '/header-image', { headers: feedHeaders })
assert.equal(launchBanner.status, 200)
assert.equal(launchBanner.headers.get('content-type'), 'image/webp')
assert.equal(Buffer.from(await launchBanner.arrayBuffer()).toString('ascii', 8, 12), 'WEBP')

if (adminToken && playerToken) {
  await request('/api/drafts', { headers: playerHeaders, expected: 403 })
  await request('/api/admin/backup', { headers: playerHeaders, expected: 403 })
  await request('/api/admin/backup', { method: 'POST', headers: { ...adminHeaders, Origin: 'https://example.org' }, expected: 403 })

  const member = (await request('/api/me', { headers: playerHeaders })).user
  assert.equal(member.role, 'user')
  assert.deepEqual(member.editorGames, [])
  const accessPath = '/api/admin/users/' + member.id
  const editorPatch = enabled => ({ role: enabled ? 'editor' : 'user' })
  await request(accessPath, { method: 'PATCH', headers: playerHeaders, body: editorPatch(true), expected: 403 })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: { role: 'unknown' }, expected: 400 })
  const editor = await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: editorPatch(true) })
  assert.equal(editor.role, 'editor')
  assert.deepEqual(editor.editorGames, ['sudoku', 'nonograms'])
  await request('/api/drafts', { headers: playerHeaders })
  await request('/api/games/nonograms/pack-drafts', { headers: playerHeaders })
  await request('/api/admin/users', { headers: playerHeaders, expected: 403 })
  await request('/api/admin/levels', { headers: playerHeaders, expected: 403 })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: editorPatch(false) })
  await request('/api/drafts', { headers: playerHeaders, expected: 403 })
  assert.deepEqual(await request('/api/catalog', { headers: playerHeaders }), await request('/api/catalog', { headers: adminHeaders }))
  const promoted = await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: { role: 'admin' } })
  assert.equal(promoted.role, 'admin')
  await request('/api/admin/levels', { headers: playerHeaders })
  await request('/api/drafts', { headers: playerHeaders })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: { role: 'user' } })
  await request('/api/admin/levels', { headers: playerHeaders, expected: 403 })

  const job = await request('/api/jobs', { method: 'POST', headers: adminHeaders,
    body: { kind: 'generate', options: { seed: 'aviarium-v1:first-light', difficulty: 'Easy', unique: true } } })
  const jobResult = async id => until(async () => {
    const current = (await request('/api/jobs', { headers: adminHeaders })).find(item => item.id === id)
    return current?.status === 'complete' && current.result
  }, 'server puzzle job')
  const generated = await jobResult(job.id)
  assert.equal(generated.grid, generateQuickPuzzle('aviarium-v1:first-light', 'Easy'))
  const draft = await request('/api/drafts', { method: 'POST', headers: adminHeaders,
    body: { grid: generated.grid, title: updatedTitle, generationJob: job.id } })
  const verifyDraft = draft => request('/api/jobs', { method: 'POST', headers: adminHeaders,
    body: { kind: 'validate', draftId: draft.id, version: draft.version } })
  const validation = await verifyDraft(draft)
  const verified = await jobResult(validation.id)
  assert.equal(verified.kind, 'unique')
  assert.equal(verified.steps.flatMap(step => step.updates).filter(update => update.filledValue).length,
    Array.from(generated.grid).filter(value => value === '0').length)
  await request('/api/drafts/' + draft.id + '/publish', {
    method: 'POST', headers: adminHeaders, body: { jobId: validation.id }, expected: 409,
  })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: editorPatch(true) })
  const packId = crypto.randomUUID()
  const item = (id, extra = {}) => ({ title: id, grid: generated.grid, ruleset: 1, levelId: 'pack:' + packId + ':' + id, ...extra })
  const original = Array.from({ length: 10 }, (_, index) => item('original-' + index))
  const inserted = Array.from({ length: 5 }, (_, index) => item('inserted-' + index))
  const appended = Array.from({ length: 10 }, (_, index) => item('appended-' + index, { rules: { hints: false } }))
  const form = { localId: packId, format: 1, game: 'sudoku', title: updatedTitle, description: '', theme: 'default',
    rules: { hints: true, autoNotes: true, inOrder: true, lives: null, timeTrial: false }, puzzles: original }
  const create = () => request('/api/pack-drafts', { method: 'POST', headers: playerHeaders, body: form })
  let owned = await create()
  assert.equal((await create()).id, owned.id)
  const draftUrl = '/api/pack-drafts/' + owned.id
  const replace = (data, headers = playerHeaders, mode = '', expected = 200) =>
    request(draftUrl + mode, { method: 'PUT', headers, body: { data, version: owned.version }, expected })
  await replace(owned.data, adminHeaders, '', 409)
  await replace(owned.data, playerHeaders, '?mode=admin', 403)
  owned = await replace({ ...owned.data, description: 'Edited explicitly' }, adminHeaders, '?mode=admin')
  assert.equal(owned.lastEditedBy, (await request('/api/me', { headers: adminHeaders })).user.id)
  const publish = () => request(draftUrl + '/publish', { method: 'POST', headers: playerHeaders, body: { version: owned.version } })
  const fetchPack = revision => request('/api/packs/' + owned.id + '/' + revision, { headers: playerHeaders })
  owned = await publish()
  const firstPack = await fetchPack(1)
  const firstLevels = packLevels(firstPack)
  const completionEvents = []
  function playPackLevel(pack, level, { headers = playerHeaders, expected = 200, complete = false } = {}) {
    const board = rules.create(Array.from(level.grid, Number))
    if (complete) board.entries = validate(board.entries).solution
    return request('/api/progress', { method: 'POST', headers, expected,
      body: { mutationId: crypto.randomUUID(), sessionId: crypto.randomUUID(), baseRevision: 0, archived: false,
        data: { game: 'sudoku', format: 1, ruleset: 1, level: level.id, levelRevision: level.revision,
          packRevision: pack.revision, board, undo: [], redo: [], elapsedMs: 50, completed: complete } } })
  }
  for (const oldLevel of firstLevels) {
    await playPackLevel(firstPack, oldLevel, { complete: true })
    completionEvents.push({ level: oldLevel.id, revision: oldLevel.revision, packRevision: 1 })
  }
  owned = await replace({ ...owned.data, puzzles: [...owned.data.puzzles.slice(0, 5), ...inserted, ...owned.data.puzzles.slice(5)] })
  owned = await publish()
  const secondPack = await fetchPack(2)
  let progressPath = packProgress(secondPack, completionEvents)
  assert.equal(progressPath.solved.filter(Boolean).length, 10)
  assert.deepEqual(progressPath.playable.slice(5, 10), Array(5).fill(true))
  owned = await replace({ ...owned.data, puzzles: [...owned.data.puzzles, ...appended] })
  owned = await publish()
  const thirdPack = await fetchPack(3)
  const thirdLevels = packLevels(thirdPack)
  progressPath = packProgress(thirdPack, completionEvents)
  assert.equal(thirdLevels.length, 25)
  assert.equal(progressPath.solved.filter(Boolean).length, 10)
  assert.equal(progressPath.next, 15)
  assert.equal(progressPath.playable[15], true)
  assert.equal(progressPath.playable[16], false)
  assert.deepEqual(thirdLevels.filter(level => level.id.includes(':original-')).map(level => [level.id, level.revision]),
    firstLevels.map(level => [level.id, level.revision]))
  await playPackLevel(thirdPack, thirdLevels[15], { headers: adminHeaders, expected: 422 })
  await playPackLevel(thirdPack, thirdLevels[16], { expected: 422 })
  await playPackLevel(thirdPack, thirdLevels[15], { complete: true })
  await playPackLevel(thirdPack, thirdLevels[16], { complete: true })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: editorPatch(false) })
  console.info('Pack update checks passed: permissions, stable level revisions, and 10 → 15 → 25 ordered progression.')

  const sessionId = crypto.randomUUID()
  const initial = { game: 'sudoku', format: 1, ruleset: 1, level: selected.id, levelRevision: selected.revision,
    board: rules.create(level), undo: [], redo: [], elapsedMs: 0, completed: false }
  const save = (data, baseRevision) => ({ data, sessionId, baseRevision, mutationId: crypto.randomUUID(), archived: false })
  const push = (body, expected = 200) => request('/api/progress', { headers: playerHeaders, method: 'POST', body, expected })
  const raw = save(initial, 0)
  const wrongQuickId = { ...initial, level: 'quick-' + '0'.repeat(36) }
  const wrongQuick = await push({ ...save(wrongQuickId, 0),
    quickPlay: { seed: 'mismatched-seed', difficulty: 'Easy', version: quickPlayVersion } }, 422)
  assert.equal(wrongQuick.code, 'level_version_unavailable')
  assert.equal((await push(raw)).revision, 1)
  assert.equal((await push(raw)).revision, 1)
  await push({ ...raw, data: { ...initial, elapsedMs: 10 } }, 409)
  const done = { ...initial, board: { ...initial.board, entries: solution }, completed: true }
  assert.equal((await push(save(done, 1))).revision, 2)
  const conflict = await push(save({ ...initial, elapsedMs: 50 }, 1))
  assert.notEqual(conflict.id, sessionId)
  assert.equal(conflict.parentId, sessionId)
  const progress = await request('/api/progress', { headers: playerHeaders })
  assert.ok(progress.completions.some(item => item.level === selected.id))
  assert.ok(progress.sessions.some(item => item.id === conflict.id))

  const savedGames = []
  for (let i = 0; i < 6; i++) {
    savedGames.push(await push({ ...save(initial, 0), updatedAt: Date.now() - (6 - i) * 60_000 }))
  }
  const retained = (await request('/api/progress', { headers: playerHeaders })).sessions
  const resumable = retained.filter(item => !item.archived && !item.data.completed)
  assert.equal(resumable.length, 5)
  assert.ok(resumable.some(item => item.id === savedGames.at(-1).id))
  assert.equal(retained.find(item => item.id === savedGames[0].id).archived, true)
  const newest = savedGames.at(-1)
  assert.equal((await push({ ...save(newest.data, 0), sessionId: newest.id, archived: true })).archived, true)
  assert.equal((await push({ ...save(newest.data, newest.revision), sessionId: newest.id })).archived, true)
  if (process.env.AVIARIUM_TEST_BACKUPS) {
    const backup = await request('/api/admin/backup', { headers: adminHeaders })
    const { folder, retention, schedule } = backup
    await request('/api/admin/backup', { method: 'PUT', headers: adminHeaders,
      body: { folder: 'smoke', retention: 1, schedule: '0 3 * * *' } })
    for (let i = 0; i < 2; i++) {
      const previous = await request('/api/admin/backup', { headers: adminHeaders })
      await request('/api/admin/backup', { method: 'POST', headers: adminHeaders })
      await until(async () => {
        const status = await request('/api/admin/backup', { headers: adminHeaders })
        if (status.error) throw new Error(status.error)
        return status.last_success && status.last_success !== previous.last_success && status.archives.length === 1
      }, 'rolling backup')
    }
    await request('/api/admin/backup', { method: 'PUT', headers: adminHeaders, body: { folder, retention, schedule } })
  }
  console.info('API checks passed: permissions, durable jobs, publish revisions, conflict preservation, completion', process.env.AVIARIUM_TEST_BACKUPS ? ', backups' : '')
}

const browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM, args: ['--no-sandbox'] })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  for (const route of ['/', '/games/sudoku', '/studio', '/admin']) {
    await page.goto(origin + route)
    await page.getByRole('link', { name: 'Login with Pocket ID' }).waitFor()
    assert.equal(await page.getByRole('link').count(), 1)
    assert.equal(await page.getByRole('button').count(), 0)
    assert.equal(await page.getByRole('banner').count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Game library' }).count(), 0)
  }
  await context.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Sudoku', exact: true }).count(), 1)
  const mobileSession = await context.newCDPSession(page)
  const rail = page.locator('.app-rail')
  const layout = () => rail.evaluate(node => ({
    bottom: getComputedStyle(node).bottom,
    padding: getComputedStyle(node).paddingBottom,
  }))
  await mobileSession.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 0, bottomMax: 32 } })
  assert.deepEqual(await layout(), { bottom: '-32px', padding: '37px' })
  await mobileSession.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 32, bottomMax: 32 } })
  assert.deepEqual(await layout(), { bottom: '0px', padding: '37px' })
  await mobileSession.send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
  await mobileSession.detach()
  const mobileChrome = () => rail.evaluate(element => ({
    rail: getComputedStyle(element).backgroundColor,
    document: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    shell: getComputedStyle(document.querySelector('.app-shell')).backgroundColor,
    content: getComputedStyle(document.querySelector('.main-frame')).backgroundColor,
    header: getComputedStyle(document.querySelector('.site-header')).backgroundColor,
    theme: document.querySelector('meta[name="theme-color"]').content,
  }))
  assert.deepEqual(await mobileChrome(), {
    rail: 'rgb(255, 253, 242)', document: 'rgb(255, 253, 242)', body: 'rgb(255, 253, 242)',
    shell: 'rgb(255, 253, 242)', content: 'rgb(244, 241, 222)', header: 'rgb(255, 253, 242)', theme: '#fffdf2',
  })
  assert.equal(await page.locator('.app-rail .account-menu').evaluate(element => getComputedStyle(element).borderInlineStartWidth), '0px')
  assert.equal(await page.getByRole('contentinfo').count(), 0)
  await openSettings(page, 'About')
  await page.getByRole('heading', { name: 'About Aviarium' }).waitFor()
  await page.reload()
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  await page.getByText('Version ' + version, { exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Aviarium on GitHub' }).getAttribute('href'),
    'https://github.com/Trustadz/aviarium')
  await page.getByRole('link', { name: 'Library', exact: true }).click()

  const boardAppearance = locator => locator.evaluate(board => Array.from(board.querySelectorAll('.cell'), cell => {
    const style = getComputedStyle(cell)
    return [cell.textContent, style.backgroundColor, style.color, style.borderRightColor]
  }))
  const heroPreview = page.locator('.hero-art .board')
  const cardPreview = page.locator('.game-card-image .board')
  await cardPreview.waitFor()
  assert.equal(await cardPreview.locator('.cell').count(), 81)
  assert.deepEqual(await boardAppearance(heroPreview), await boardAppearance(cardPreview))
  const featured = page.getByRole('region', { name: 'Featured games' })
  const heroTrack = featured.locator('.hero-track')
  const swipeHero = async distance => {
    const box = await heroTrack.boundingBox()
    assert.ok(box)
    const session = await context.newCDPSession(page)
    const startX = box.x + 24
    const startY = box.y + 24
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] })
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: startX + (distance * step) / 6, y: startY }],
      })
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  }
  assert.equal(await featured.locator('.hero-controls, .hero-timer').count(), 0)
  const sudokuSlide = featured.locator('.hero-slide.hero-sudoku')
  const sudokuLayout = () => sudokuSlide.evaluate(slide => {
    const description = slide.querySelector('.hero-content > p:not(.hero-kicker)')
    return {
      boardRotation: getComputedStyle(slide.querySelector('.hero-art')).transform,
      headingSize: getComputedStyle(slide.querySelector('h1')).fontSize,
      descriptionWidth: description.offsetWidth,
      descriptionHeight: description.offsetHeight,
    }
  })
  const sudokuAtRest = await sudokuLayout()
  assert.notEqual(sudokuAtRest.boardRotation, 'none')
  await swipeHero(-120)
  assert.deepEqual(await sudokuLayout(), sudokuAtRest)
  await featured.getByRole('heading', { name: 'Nonograms' }).waitFor()
  assert.equal(await featured.getByRole('button', { name: 'Show Nonograms' }).getAttribute('aria-pressed'), 'true')
  await featured.locator('.hero-cover img').evaluate(image => image.decode())
  await featured.press('ArrowLeft')
  await featured.getByRole('heading', { name: 'Aviarium' }).waitFor()
  assert.equal(await featured.getByRole('button', { name: 'Show Sudoku' }).getAttribute('aria-pressed'), 'true')
  await featured.getByRole('button', { name: 'Show Nonograms' }).tap()
  await featured.getByRole('button', { name: 'Explore Nonograms' }).tap()
  await page.waitForURL('**/games/nonograms')
  await page.getByRole('button', { name: 'Exit to library' }).tap()
  await featured.getByRole('heading', { name: 'Aviarium' }).waitFor()
  const cardSurface = await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Sudoku', exact: true }) }).evaluate(card => getComputedStyle(card).backgroundColor)
  assert.equal(cardSurface, 'rgb(255, 253, 242)')
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await page.getByRole('link', { name: 'Sudoku', exact: true }).waitFor()
  if (process.env.AVIARIUM_SCREENSHOTS) await page.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/library-mobile.png', fullPage: true })
  await openSettings(page, 'Account settings')
  await page.getByRole('dialog', { name: 'Account settings' }).waitFor()
  assert.equal(await page.getByText(/(export|import) saves/i).count(), 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await openSettings(page, 'Device settings')
  await page.getByLabel('Theme').selectOption('dark')
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark')
  assert.deepEqual(await mobileChrome(), {
    rail: 'rgb(51, 53, 76)', document: 'rgb(51, 53, 76)', body: 'rgb(51, 53, 76)',
    shell: 'rgb(51, 53, 76)', content: 'rgb(38, 40, 60)', header: 'rgb(51, 53, 76)', theme: '#33354c',
  })
  assert.equal(await page.getByLabel('Show timer').count(), 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.reload()
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark')
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  assert.equal(await page.getByRole('banner').count(), 0)
  assert.equal(await page.getByRole('contentinfo').count(), 0)
  await page.getByRole('button', { name: 'Exit to library' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Browse puzzles' }).count(), 0)

  const catalogContext = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  await catalogContext.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  await catalogContext.route(origin + '/api/games/sudoku/packs', route => route.abort(), { times: 1 })
  await catalogContext.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'packs') {
        window.packCacheWriteFailed = true
        throw new DOMException('The device storage is full.', 'QuotaExceededError')
      }
      return originalPut.apply(this, args)
    }
  })
  const catalogPage = await catalogContext.newPage()
  await catalogPage.goto(origin + '/games/sudoku')
  await catalogPage.getByText('Could not load packs.', { exact: true }).waitFor()
  assert.equal(await catalogPage.getByText('No packs available on this device yet.', { exact: true }).count(), 0)
  await catalogPage.getByRole('button', { name: 'Retry loading packs' }).click()
  const budgies = catalogPage.getByRole('button', { name: /^Budgies/ })
  await budgies.waitFor()
  await catalogPage.waitForFunction(() => window.packCacheWriteFailed)
  await budgies.click()
  await catalogPage.getByRole('heading', { name: 'Budgies', exact: true }).waitFor()
  await catalogContext.close()
  const cachedCatalog = await browser.newContext({ serviceWorkers: 'block' })
  await cachedCatalog.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const cachedCatalogPage = await cachedCatalog.newPage()
  await cachedCatalogPage.goto(origin + '/games/sudoku')
  await cachedCatalogPage.getByRole('button', { name: /^Budgies/ }).waitFor()
  await cachedCatalogPage.waitForFunction(() => Object.keys(localStorage)
    .some(key => key.startsWith('aviarium:pack-index:') && localStorage[key].includes('budgies')))
  await cachedCatalog.route(origin + '/api/games/sudoku/packs', route => route.abort(), { times: 1 })
  await cachedCatalogPage.reload()
  await cachedCatalogPage.getByRole('button', { name: 'Retry loading packs' }).waitFor()
  await cachedCatalogPage.getByRole('button', { name: /^Budgies/ }).waitFor()
  await cachedCatalogPage.getByRole('button', { name: 'Retry loading packs' }).click()
  await cachedCatalogPage.getByRole('button', { name: 'Retry loading packs' }).waitFor({ state: 'hidden' })
  await cachedCatalogPage.getByRole('button', { name: /^Budgies/ }).waitFor()
  await cachedCatalog.close()
  console.info('Pack catalog checks passed: retry, cached cards during a failed refresh, and opening a pack when the cache write fails.')

  await page.goto(`${origin}/games/sudoku?puzzle=${selected.id}&revision=${selected.revision}`)
  await page.getByRole('button', { name: 'Sudoku settings' }).click()
  await page.getByLabel('Show timer').uncheck()
  assert.equal(await page.getByLabel('Theme').count(), 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  assert.equal(await page.getByRole('button', { name: /download/i }).count(), 0)
  await page.getByRole('button', { name: 'Play shared puzzle' }).click()
  await page.getByRole('button', { name: 'Game menu' }).waitFor()
  assert.equal(await page.getByRole('banner').count(), 0)
  assert.equal(await page.getByRole('contentinfo').count(), 0)
  const firstBlank = level.indexOf(0)
  const cell = (value) => page.getByRole('button', { name: `Row ${Math.floor(firstBlank / 9) + 1}, column ${firstBlank % 9 + 1}, ${value}`, exact: true })
  await cell('empty').tap()
  await page.getByRole('button', { name: 'Notes', exact: true }).tap()
  await page.getByRole('button', { name: '6', exact: true }).tap()
  await cell('empty').getByText('6', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Undo' }).tap()
  assert.equal(await cell('empty').textContent(), '')
  await page.getByRole('button', { name: 'Redo' }).tap()
  await cell('empty').getByText('6', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Notes', exact: true }).tap()
  await cell('empty').press(String(solution[firstBlank]))
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByRole('heading', { name: 'Game paused' }).waitFor()
  await page.getByRole('button', { name: 'Resume game' }).tap()
  await page.getByRole('button', { name: 'Game menu' }).tap()
  await page.getByRole('button', { name: 'Exit to library' }).tap()
  await page.getByRole('banner').waitFor()
  await page.waitForFunction(() => caches.has('aviarium-game-sudoku'))
  assert.equal(await page.getByRole('button', { name: 'Remove Sudoku download' }).count(), 0)
  await openSettings(page, 'Device settings')
  await page.getByLabel('E-reader mode').check()
  await page.getByRole('button', { name: 'Close' }).tap()
  await page.getByRole('button', { name: 'Explore Sudoku' }).tap()
  assert.equal(await page.locator('.reader').count(), 1)
  await context.setOffline(true)
  await page.reload()
  await page.locator('.app.reader[data-theme=dark]').waitFor()
  const track = page.locator('.continue-track').first()
  assert.equal(await track.evaluate(element => getComputedStyle(element).paddingBottom), '16px')
  await page.getByRole('button', { name: 'Resume', exact: true }).first().tap()
  await cell(String(solution[firstBlank])).waitFor()
  if (process.env.AVIARIUM_SCREENSHOTS) await page.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/player-reader-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 844, height: 390 })
  const keypadBounds = await page.getByRole('button', { name: '1', exact: true }).boundingBox()
  assert.ok(keypadBounds && keypadBounds.y + keypadBounds.height <= 390)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.evaluate(() => {
    const cached = JSON.parse(localStorage.getItem('aviarium:session'))
    cached.expiresAt = new Date(Date.now() - 1000).toISOString()
    localStorage.setItem('aviarium:session', JSON.stringify(cached))
  })
  await page.reload()
  await page.getByRole('link', { name: 'Login with Pocket ID' }).waitFor()
  assert.equal(await page.locator('.board').count(), 0)
  assert.deepEqual(pageErrors, [])
  if (adminToken) {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 945 } })
    await desktop.addCookies([{ name: 'aviarium', value: adminToken, url: origin }])
    const adminPage = await desktop.newPage()
    await adminPage.goto(origin)
    const catalog = adminPage.locator('.library')
    const card = catalog.locator('.game-card').filter({ has: adminPage.getByRole('heading', { name: 'Sudoku', exact: true }) })
    await card.waitFor()
    const tags = await card.locator('.badge').allTextContents()
    const cardColor = await card.evaluate(el => getComputedStyle(el).backgroundColor)
    const artHeight = await card.locator('.game-card-image').evaluate(el => el.clientHeight)
    await adminPage.getByRole('link', { name: 'Studio' }).click()
    await adminPage.getByRole('heading', { name: 'Studio', exact: true }).waitFor()
    assert.deepEqual(await card.locator('.badge').allTextContents(), tags)
    assert.notEqual(await card.evaluate(el => getComputedStyle(el).backgroundColor), cardColor)
    assert.equal(await card.locator('.game-card-image').evaluate(el => el.clientHeight), artHeight)
    assert.equal(await adminPage.locator('.hero').count(), 0)
    await adminPage.getByRole('button', { name: 'Numbers', exact: true }).click()
    const search = catalog.getByRole('textbox', { name: 'Search games' })
    await search.fill('no matching game')
    await catalog.getByText('No games match this view.').waitFor()
    await search.fill('Sudoku')
    await card.waitFor()
    await search.clear()
    await adminPage.getByRole('button', { name: 'All games', exact: true }).click()
    await card.getByRole('link', { name: 'Edit', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'My packs' }).waitFor()
    await adminPage.getByLabel('Pack title', { exact: true }).fill('Studio browser check')
    await adminPage.getByRole('button', { name: 'New pack', exact: true }).click()
    await adminPage.getByRole('button', { name: 'Add level', exact: true }).click()
    await adminPage.getByLabel('Puzzle title', { exact: true }).fill('First chapter puzzle')
    await adminPage.getByRole('button', { name: 'Add level', exact: true }).click()
    await adminPage.getByLabel('Puzzle title', { exact: true }).fill('Second stop')
    await adminPage.getByRole('button', { name: 'Add level', exact: true }).click()
    await adminPage.getByLabel('Puzzle title', { exact: true }).fill('Third stop')
    const levelRows = adminPage.locator('.pack-level-row')
    const order = () => levelRows.locator('strong').allTextContents()
    const grip = adminPage.getByRole('button', { name: 'Reorder Third stop', exact: true })
    const from = await grip.boundingBox()
    const to = await levelRows.first().boundingBox()
    await adminPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await adminPage.mouse.down()
    await adminPage.mouse.move(from.x + from.width / 2, to.y + to.height / 4, { steps: 12 })
    await adminPage.mouse.up()
    assert.deepEqual(await order(), ['Third stop', 'First chapter puzzle', 'Second stop'])
    assert.equal(await adminPage.getByLabel('Puzzle title', { exact: true }).inputValue(), 'Third stop')
    await adminPage.getByRole('button', { name: 'Move Third stop down', exact: true }).click()
    assert.deepEqual(await order(), ['First chapter puzzle', 'Third stop', 'Second stop'])
    await grip.press('ArrowDown')
    assert.deepEqual(await order(), ['First chapter puzzle', 'Second stop', 'Third stop'])
    await adminPage.getByText('Saved on this device', { exact: true }).waitFor()
    await adminPage.reload()
    await adminPage.getByRole('button', { name: 'Add level', exact: true }).waitFor()
    assert.deepEqual(await order(), ['First chapter puzzle', 'Second stop', 'Third stop'])
    for (const name of ['Second stop', 'Third stop']) {
      await adminPage.getByRole('button', { name: 'Actions for ' + name, exact: true }).click()
      adminPage.once('dialog', dialog => dialog.accept())
      await adminPage.locator('.pack-level-menu.is-open').getByRole('button', { name: 'Remove level', exact: true }).click()
    }
    await adminPage.getByRole('button', { name: 'Paste grid', exact: true }).click()
    await adminPage.getByLabel('Grid', { exact: true }).fill(selected.grid)
    await adminPage.getByRole('button', { name: 'Use grid', exact: true }).click()
    await adminPage.getByText(/Unique solution/).waitFor()
    await adminPage.getByText('Level rules · Uses pack rules', { exact: true }).click()
    const playerAids = adminPage.getByRole('group', { name: 'Player aids' })
    const hintRule = playerAids.getByRole('switch', { name: 'Allow hints', exact: true })
    assert.equal(await hintRule.isEnabled(), true)
    await hintRule.uncheck()
    await playerAids.getByRole('button', { name: 'Reset Allow hints to pack default', exact: true }).click()
    assert.equal(await hintRule.isChecked(), true)
    await hintRule.uncheck()
    assert.equal(await adminPage.getByLabel('Level access', { exact: true }).count(), 0)
    await adminPage.getByRole('button', { name: 'Test play', exact: true }).click()
    await adminPage.getByRole('button', { name: 'Back to editor', exact: true }).click()
    await adminPage.getByText(/Unique solution/).waitFor()
    await adminPage.getByRole('button', { name: 'Appearance', exact: true }).click()
    await adminPage.getByText('Twilight', { exact: true }).click()
    assert.equal(await adminPage.getByRole('radio', { name: 'Twilight', exact: true }).isChecked(), true)
    await adminPage.getByRole('button', { name: 'Preview', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'First chapter puzzle', exact: true }).waitFor()
    await adminPage.getByText(/No hints/).waitFor()
    await adminPage.getByRole('button', { name: 'Dark', exact: true }).click()
    assert.equal(await adminPage.locator('.studio-preview').getAttribute('data-theme'), 'dark')
    assert.equal(await adminPage.locator('.pack-trail .primary').evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(240, 231, 253)')
    await adminPage.getByText('Draft saved online', { exact: true }).waitFor()
    assert.equal(await adminPage.getByRole('button', { name: 'Save draft online', exact: true }).count(), 0)
    await adminPage.getByRole('button', { name: 'Appearance', exact: true }).click()
    const description = adminPage.getByLabel('Description', { exact: true })
    let releaseSave
    const delaySave = new Promise(resolve => { releaseSave = resolve })
    let startedSave
    const pendingSave = new Promise(resolve => { startedSave = resolve })
    await adminPage.route('**/api/games/sudoku/pack-drafts/*', async route => {
      if (route.request().method() === 'PUT' && route.request().postDataJSON().data.description === 'First draft edit') {
        startedSave()
        await delaySave
      }
      await route.continue()
    })
    await description.fill('First draft edit')
    await pendingSave
    await description.fill('Newer draft edit')
    releaseSave()
    await adminPage.getByText('Draft saved online', { exact: true }).waitFor()
    assert.equal(await description.inputValue(), 'Newer draft edit')
    const onlineDrafts = await adminPage.request.get(origin + '/api/pack-drafts').then(response => response.json())
    assert.equal(onlineDrafts.find(pack => pack.data.title === 'Studio browser check').data.description, 'Newer draft edit')
    await adminPage.unroute('**/api/games/sudoku/pack-drafts/*')
    await adminPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await until(() => adminPage.evaluate(async () =>
      Boolean(await caches.match('/__aviarium/last-played', { cacheName: 'aviarium-game-sudoku' }))), 'Studio offline download')
    await desktop.setOffline(true)
    await adminPage.reload()
    await adminPage.getByLabel('Puzzle title', { exact: true }).waitFor()
    await adminPage.getByLabel('Puzzle title', { exact: true }).fill('Edited offline')
    await adminPage.getByText('Saved on this device', { exact: true }).waitFor()
    await adminPage.reload()
    await adminPage.getByLabel('Puzzle title', { exact: true }).waitFor()
    assert.equal(await adminPage.getByLabel('Puzzle title', { exact: true }).inputValue(), 'Edited offline')
    await desktop.setOffline(false)
    await adminPage.getByRole('button', { name: 'Publish pack', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'Publish pack', exact: true }).waitFor()
    await adminPage.getByRole('button', { name: 'Publish to catalog', exact: true }).click()
    await adminPage.getByText('Published pack revision 1', { exact: true }).waitFor()
    if (process.env.AVIARIUM_SCREENSHOTS) await adminPage.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/studio-desktop.png', fullPage: true })
    const published = (await adminPage.request.get(origin + '/api/packs').then(response => response.json()))
      .find(pack => pack.data.title === 'Studio browser check')
    assert.ok(published)
    const themedPlayer = await desktop.newPage()
    await themedPlayer.addInitScript(() => localStorage.setItem('aviarium:theme', 'dark'))
    await themedPlayer.goto(origin + '/games/sudoku/packs/' + published.id + '/' + published.revision)
    await themedPlayer.getByRole('button', { name: 'Play Edited offline', exact: true }).click()
    await themedPlayer.locator('.play-page .board').waitFor()
    const playerBackground = await themedPlayer.locator('.game-frame').evaluate(el => getComputedStyle(el).backgroundColor)
    const boardBackground = await themedPlayer.locator('.play-page .board').evaluate(el => getComputedStyle(el).backgroundColor)
    const padBackground = await themedPlayer.locator('.number-pad button').first().evaluate(el => getComputedStyle(el).backgroundColor)
    assert.equal(padBackground, 'rgb(62, 51, 86)')
    assert.equal(await themedPlayer.getByRole('button', { name: 'Notes', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), boardBackground)
    assert.notEqual(boardBackground, 'rgb(27, 48, 40)')
    assert.notEqual(playerBackground, 'rgb(16, 31, 26)')
    await themedPlayer.getByRole('button', { name: 'Notes', exact: true }).click()
    assert.equal(await themedPlayer.getByRole('button', { name: 'Notes', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), padBackground)
    await themedPlayer.getByRole('button', { name: 'Sudoku settings', exact: true }).click()
    assert.equal(await themedPlayer.getByRole('dialog', { name: 'Sudoku settings' }).evaluate(el => getComputedStyle(el).backgroundColor), boardBackground)
    await themedPlayer.close()
    await adminPage.getByRole('button', { name: 'Unpublish', exact: true }).click()
    await adminPage.getByText('Pack unpublished', { exact: true }).waitFor()
    const listed = async () => (await adminPage.request.get(origin + '/api/packs').then(response => response.json()))
      .some(pack => pack.id === published.id)
    assert.equal(await listed(), false)
    const draftPath = '/api/games/sudoku/pack-drafts'
    const [unpublished] = (await request(draftPath, { headers: adminHeaders })).filter(pack => pack.id === published.id)
    const republish = () => request(draftPath + '/' + published.id + '/publish', {
      method: 'POST', body: { version: unpublished.version }, headers: adminHeaders,
    })
    await adminPage.getByRole('button', { name: 'Delete pack', exact: true }).click()
    const deletePack = adminPage.getByRole('dialog', { name: 'Delete Studio browser check?' })
    await deletePack.getByText('This removes the pack from My packs.', { exact: true }).waitFor()
    const liveAgain = await republish()
    assert.equal(liveAgain.published, published.revision)
    assert.equal(liveAgain.version, unpublished.version + 1)
    await deletePack.getByRole('button', { name: 'Delete pack', exact: true }).click()
    await deletePack.getByText('This will also un-publish it.', { exact: true }).waitFor()
    assert.equal(await listed(), true)
    await deletePack.getByRole('button', { name: 'Cancel', exact: true }).click()
    await adminPage.getByRole('button', { name: 'Delete pack', exact: true }).click()
    await deletePack.getByText('This will also un-publish it.', { exact: true }).waitFor()
    await deletePack.getByRole('button', { name: 'Cancel', exact: true }).click()
    await adminPage.reload()
    await adminPage.getByRole('button', { name: 'My packs', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'My packs' }).waitFor()
    const updatedCard = adminPage.getByRole('listitem').filter({ hasText: 'Studio browser check' })
    await updatedCard.getByText(/Live revision/).waitFor()
    await updatedCard.getByRole('button', { name: 'Open pack', exact: true }).click()
    await adminPage.getByRole('button', { name: 'Unpublish', exact: true }).waitFor()
    await adminPage.getByRole('button', { name: 'Delete pack', exact: true }).click()
    await deletePack.getByText('This will also un-publish it.', { exact: true }).waitFor()
    assert.equal(await deletePack.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => document.activeElement === el), true)
    await deletePack.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await listed(), true)
    await adminPage.getByRole('button', { name: 'Delete pack', exact: true }).click()
    await deletePack.getByRole('button', { name: 'Delete pack', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'My packs', exact: true }).waitFor()
    assert.equal(await listed(), false)
    assert.equal((await adminPage.request.get(origin + '/api/packs/' + published.id + '/' + published.revision)).status(), 200)
    const remainingDrafts = await adminPage.request.get(origin + '/api/pack-drafts').then(response => response.json())
    assert.equal(remainingDrafts.some(pack => pack.id === published.id), false)
    await adminPage.getByRole('navigation', { name: 'Main navigation' }).waitFor()
    await openSettings(adminPage, 'Administration')
    await adminPage.getByRole('heading', { name: 'Administration' }).waitFor()
    await adminPage.getByRole('button', { name: 'Run now' }).waitFor()
    if (playerToken) {
      const users = await request('/api/admin/users', { headers: adminHeaders })
      const member = (await request('/api/me', { headers: playerHeaders })).user
      const person = users.find(item => item.id === member.id)
      const role = adminPage.getByRole('combobox', { name: 'Role for ' + person.name })
      await role.selectOption('editor')
      await until(async () => {
        const result = await request('/api/me', { headers: playerHeaders })
        return result.user.role === 'editor'
      }, 'Editor role grant from Admin')
      const editorContext = await browser.newContext()
      await editorContext.addCookies([{ name: 'aviarium', value: playerToken, url: origin }])
      const editorPage = await editorContext.newPage()
      await editorPage.goto(origin)
      await editorPage.getByRole('link', { name: 'Studio' }).click()
      await editorPage.getByRole('link', { name: 'Create for Sudoku', exact: true }).waitFor()
      await editorPage.getByRole('link', { name: 'Create for Nonograms', exact: true }).click()
      await editorPage.getByRole('heading', { name: 'My packs' }).waitFor()
      await editorPage.getByRole('button', { name: 'Account menu' }).click()
      assert.equal(await editorPage.getByRole('button', { name: 'Administration' }).count(), 0)
      await editorContext.close()
      await role.selectOption('user')
      await until(async () => {
        const result = await request('/api/me', { headers: playerHeaders })
        return result.user.role === 'user'
      }, 'Editor role revocation from Admin')
      await request('/api/games/nonograms/pack-drafts', { headers: playerHeaders, expected: 403 })
    }
    await desktop.close()
  }
  if (playerToken) {
    const quiet = starting.find(item => item.id === 'quiet-current')
    const blank = quiet.grid.indexOf('0')
    const digit = validate(Array.from(quiet.grid, Number)).solution[blank]
    const first = await browser.newContext()
    const second = await browser.newContext()
    for (const context of [first, second]) await context.addCookies([{ name: 'aviarium', value: playerToken, url: origin }])
    const deviceA = await first.newPage()
    await deviceA.goto(origin)
    await deviceA.getByRole('button', { name: 'Account menu' }).filter({ hasText: 'Test Player' }).waitFor()
    await deviceA.goto(`${origin}/games/sudoku?puzzle=${quiet.id}&revision=${quiet.revision}`)
    await deviceA.getByRole('button', { name: 'Play shared puzzle' }).click()
    const label = `Row ${Math.floor(blank / 9) + 1}, column ${blank % 9 + 1}, `
    await deviceA.getByRole('button', { name: label + 'empty', exact: true }).press(String(digit))
    await deviceA.getByRole('button', { name: 'Game menu' }).click()
    await until(async () => {
      const progress = await request('/api/progress', { headers: playerHeaders })
      return progress.sessions.some(item => item.data.level === quiet.id && item.data.board.entries[blank] === digit)
    }, 'device A progress upload')
    await deviceA.waitForFunction(() => caches.has('aviarium-game-sudoku'))
    const deviceB = await second.newPage()
    await deviceB.goto(origin)
    await deviceB.getByRole('heading', { name: 'Game library' }).waitFor()
    await deviceB.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    assert.equal(await deviceB.evaluate(() => caches.has('aviarium-game-sudoku')), false)
    assert.equal(await deviceB.getByRole('button', { name: 'Remove Sudoku download' }).count(), 0)
    await deviceB.getByRole('button', { name: 'Explore Sudoku' }).click()
    const savedRow = deviceB.getByRole('region', { name: 'Continue' }).getByRole('listitem').filter({ hasText: 'Quiet Current' })
    const savedCell = savedRow.first().locator('.saved-board .cell').nth(blank)
    await savedCell.filter({ hasText: String(digit) }).waitFor()
    assert.deepEqual(await deviceB.locator('.game-menu > section').evaluateAll(sections =>
      sections.map(section => section.querySelector('h2')?.textContent)), ['Continue', 'Quick Play', 'Packs'])
    assert.match(await savedCell.getAttribute('class'), /entry/)
    await savedRow.getByRole('button', { name: 'Resume' }).first().click()
    await deviceB.getByRole('button', { name: label + digit, exact: true }).waitFor()
    await first.close()
    await second.close()
  }
  const packContext = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true })
  await packContext.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const packPage = await packContext.newPage()
  await packPage.goto(origin + '/games/sudoku')
  await packPage.getByRole('button', { name: /^Budgies/ }).click()
  const current = packPage.locator('.pack-trail [aria-current=step]')
  await current.getByRole('heading', { name: 'Garden Perch' }).waitFor()
  const locked = packPage.getByRole('button', { name: 'Play Eucalyptus Grove', exact: true })
  assert.equal(await locked.isDisabled(), true)
  const pins = await packPage.locator('.pack-stop-marker').evaluateAll(markers => markers.map(marker => {
    const { left, top } = marker.getBoundingClientRect()
    return { left, top }
  }))
  assert.equal(pins.length, 3)
  assert.ok(pins[0].left < pins[1].left && pins[0].left === pins[2].left)
  assert.ok(pins[0].top > pins[1].top && pins[1].top > pins[2].top)
  assert.ok(pins[0].top < 700 && pins[0].top > 0)
  assert.ok(await packPage.locator('.pack-roadmap').evaluate(roadmap => {
    const info = roadmap.querySelector('.pack-banner').getBoundingClientRect()
    const trail = roadmap.querySelector('.pack-trail').getBoundingClientRect()
    return info.top >= trail.bottom
  }))
  assert.ok(await packPage.getByRole('button', { name: 'Sudoku menu', exact: true }).evaluate(button =>
    button.getBoundingClientRect().top >= 0 && button.getBoundingClientRect().bottom <= innerHeight))
  assert.equal(await packPage.evaluate(() => document.documentElement.scrollWidth), 320)

  const headers = playerToken ? playerHeaders : adminHeaders
  const pack = (await request('/api/packs', { headers })).find(item => item.id === 'budgies')
  const firstGrid = Array.from(pack.data.puzzles[0].grid, Number)
  const firstSolution = validate(firstGrid).solution
  assert.ok(firstSolution)
  await current.getByRole('button', { name: 'Play Garden Perch', exact: true }).click()
  const cells = packPage.getByLabel('Sudoku board', { exact: true }).getByRole('button')
  for (const [index, given] of firstGrid.entries()) {
    if (!given) await cells.nth(index).press(String(firstSolution[index]))
  }
  await packPage.getByRole('button', { name: 'Back to roadmap', exact: true }).click()
  await current.getByRole('heading', { name: 'Eucalyptus Grove' }).waitFor()
  assert.ok(await current.locator('.pack-stop-marker').evaluate(marker => {
    const { top, bottom } = marker.getBoundingClientRect()
    return top >= 0 && bottom <= innerHeight
  }))
  assert.equal(await locked.isEnabled(), true)
  assert.equal(await packPage.getByRole('button', { name: 'Replay Garden Perch', exact: true }).isEnabled(), true)
  await packContext.close()
  console.info('Pack trail checks passed: bottom-to-top pins, visible next stop, and unlocking the next stop.')

  const quickPlayContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await quickPlayContext.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const quickPlayPage = await quickPlayContext.newPage()
  const serverGenerations = []
  quickPlayPage.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sudoku/quick-play')
      serverGenerations.push(request.url())
  })
  await quickPlayPage.goto(origin + '/games/sudoku')
  await quickPlayPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await until(() => quickPlayPage.evaluate(async () =>
    Boolean(await caches.match('/__aviarium/last-played', { cacheName: 'aviarium-game-sudoku' }))), 'Sudoku offline download')
  await quickPlayContext.setOffline(true)
  await quickPlayPage.reload()
  await quickPlayPage.getByRole('button', { name: 'New puzzle', exact: true }).click()
  await quickPlayPage.getByRole('heading', { name: 'Quick Play', level: 1 }).waitFor()
  await quickPlayPage.getByRole('button', { name: 'Game menu', exact: true }).click()

  const descriptor = { seed: 'offline-smoke-' + crypto.randomUUID(), difficulty: 'Medium', version: quickPlayVersion }
  const quickId = await quickPlayId(descriptor)
  const oldId = 'quick-' + createHash('sha256').update(JSON.stringify([descriptor.version, descriptor.difficulty, descriptor.seed]))
    .digest('hex').slice(0, 36)
  assert.equal(quickId, oldId)
  const quickGrid = generateQuickPuzzle(descriptor.seed, descriptor.difficulty)
  const solutionValues = validate(Array.from(quickGrid, Number)).solution
  const blank = quickGrid.indexOf('0')
  const quickCell = `Row ${Math.floor(blank / 9) + 1}, column ${blank % 9 + 1}, `
  await quickPlayPage.getByRole('button', { name: 'Enter seed', exact: true }).click()
  await quickPlayPage.getByLabel('Puzzle seed', { exact: true }).fill(formatSeedCode(descriptor.seed, descriptor.difficulty, descriptor.version))
  await quickPlayPage.getByRole('button', { name: 'Play seed', exact: true }).click()
  const quickBoard = quickPlayPage.getByLabel('Sudoku board', { exact: true })
  await quickBoard.waitFor()
  assert.equal((await quickBoard.getByRole('button').allTextContents()).map(digit => digit.trim() || '0').join(''), quickGrid)
  await quickPlayPage.getByRole('button', { name: quickCell + 'empty', exact: true }).press(String(solutionValues[blank]))
  await quickPlayPage.getByRole('button', { name: 'Game menu', exact: true }).click()
  await quickPlayPage.reload()
  await quickPlayPage.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await quickPlayPage.getByRole('button', { name: quickCell + solutionValues[blank], exact: true }).waitFor()
  await quickPlayContext.setOffline(false)
  await quickPlayPage.getByRole('button', { name: 'Game menu', exact: true }).click()
  const playbackHeaders = playerToken ? playerHeaders : adminHeaders
  await until(async () => {
    const progress = await request('/api/progress', { headers: playbackHeaders })
    return progress.levels.some(level => level.id === quickId && level.grid === quickGrid) &&
      progress.sessions.some(item => item.data.level === quickId && item.data.board.entries[blank] === solutionValues[blank])
  }, 'offline Quick Play progress and puzzle sync')
  assert.deepEqual(serverGenerations, [])
  const legacyQuickPlay = await request('/api/sudoku/quick-play', { method: 'POST', headers: playbackHeaders, body: descriptor })
  assert.equal(legacyQuickPlay.id, quickId)
  assert.equal(legacyQuickPlay.grid, quickGrid)
  await quickPlayContext.close()
  console.info('Quick Play checks passed: random and shared seed offline, reload and resume, and sync after reconnecting.')

  const nonogramApi = '/api/games/nonograms'
  const [cockatoos] = await request(nonogramApi + '/packs', { headers: playbackHeaders })
  assert.equal(cockatoos.data.puzzles.length, 5)
  assert.ok(cockatoos.data.cover.startsWith('data:image/webp;base64,'))
  const [egg, nest] = nonogramLevels(cockatoos)
  const submitNonogram = (data, expected) => request('/api/progress', { method: 'POST', headers: playbackHeaders, expected,
    body: { data, sessionId: crypto.randomUUID(), mutationId: crypto.randomUUID(), baseRevision: 0, archived: false } })
  assert.equal((await submitNonogram(createNonogramAttempt(nest, cockatoos), 422)).code, 'pack_stop_locked')
  const falseSolve = { ...createNonogramAttempt(egg, cockatoos), completed: true }
  assert.equal((await submitNonogram(falseSolve, 422)).code, 'saved_solution_invalid')
  if (playerToken) await request(nonogramApi + '/pack-drafts', { headers: playerHeaders, expected: 403 })

  const nonogramContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await nonogramContext.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const nonogramPage = await nonogramContext.newPage()
  await nonogramPage.goto(origin + '/games/nonograms')
  await nonogramPage.getByRole('button', { name: /Sulphur-crested Cockatoos/ }).tap()
  await nonogramPage.getByRole('button', { name: 'Play Cockatoo Egg' }).tap()
  const squares = nonogramPage.locator('.nonogram-cell')
  assert.deepEqual(await nonogramPage.locator('.pack-play-art').boundingBox(), { x: 0, y: 0, width: 390, height: 844 })
  const middle = squares.nth(1)
  await nonogramPage.getByRole('button', { name: 'Mark blank', exact: true }).tap()
  await middle.tap()
  await nonogramPage.getByRole('button', { name: 'Fill', exact: true }).tap()
  await middle.tap()
  assert.equal(await middle.getAttribute('data-mark'), '2')
  const dragPoint = async index => {
    const { x, y, width, height } = await squares.nth(index).boundingBox()
    return [x + width / 2, y + height / 2]
  }
  await nonogramPage.mouse.move(...await dragPoint(0))
  await nonogramPage.mouse.down()
  await nonogramPage.mouse.move(...await dragPoint(2))
  await nonogramPage.mouse.up()
  assert.deepEqual(await squares.evaluateAll(items => items.slice(0, 3).map(item => item.dataset.mark)), ['1', '2', '1'])
  const rowClue = nonogramPage.locator('.nonogram-row-clue').first()
  assert.equal(await rowClue.getAttribute('data-conflict'), 'true')
  assert.equal(await rowClue.evaluate(element => getComputedStyle(element).textDecorationLine), 'underline')
  assert.match(await middle.getAttribute('aria-description'), /row clues/)
  await nonogramPage.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual(await squares.evaluateAll(items => items.slice(0, 3).map(item => item.dataset.mark)), ['0', '2', '0'])
  assert.equal(await rowClue.getAttribute('data-conflict'), 'false')
  const columnClue = nonogramPage.locator('.nonogram-column-clues > div').first()
  await squares.nth(0).tap()
  await squares.nth(5).tap()
  assert.equal(await columnClue.getAttribute('data-conflict'), 'true')
  await nonogramPage.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await columnClue.getAttribute('data-conflict'), 'false')
  await nonogramPage.getByRole('button', { name: 'Undo', exact: true }).click()
  const target = solveByDeduction(egg.content).cells
  for (const [index, mark] of target.entries()) if (mark === 1) await squares.nth(index).tap()
  await nonogramPage.locator('.celebration-overlay').waitFor()
  const celebrationBox = await nonogramPage.locator('.celebration-overlay').boundingBox()
  assert.ok(celebrationBox && celebrationBox.width === 390 && celebrationBox.height === 844,
    'completion celebration fills the viewport')
  assert.equal(await nonogramPage.evaluate(() => document.querySelector('main')?.getAttribute('aria-hidden')), 'true',
    'completion celebration hides the game from assistive technology')
  await nonogramPage.getByRole('heading', { name: 'Puzzle solved' }).waitFor()
  const scrim = nonogramPage.locator('.celebration-scrim')
  const card = nonogramPage.locator('.celebration-results-card')
  assert.equal(await scrim.evaluate(element => getComputedStyle(element).opacity), '1')
  assert.notEqual(await card.evaluate(element => getComputedStyle(element).filter), 'none',
    'results card starts dimmed at the beginning of the fly-by')
  await until(() => card.evaluate(element => getComputedStyle(element).filter === 'brightness(1)'), 'results card at full brightness')
  assert.ok(await nonogramPage.locator('.celebration-flock').count(), 'results card is revealed while the flock is still flying')
  await nonogramPage.locator('.celebration-overlay[data-phase="results"]').waitFor({ timeout: 5000 })
  assert.equal(await scrim.evaluate(element => getComputedStyle(element).opacity), '1',
    'the game stays dimmed under the results card')
  await nonogramPage.getByRole('button', { name: 'Back to roadmap' }).tap()
  await nonogramPage.getByRole('button', { name: 'Play Nest Hollow' }).waitFor()
  await until(async () => (await request('/api/progress', { headers: playbackHeaders })).completions
    .some(item => item.level === egg.id && item.revision === egg.revision), 'synced Nonograms completion')
  await nonogramPage.getByRole('button', { name: 'Nonograms menu' }).tap()
  await until(() => nonogramPage.evaluate(async () =>
    Boolean(await caches.match('/__aviarium/last-played', { cacheName: 'aviarium-game-nonograms' }))), 'Nonograms offline download')
  await nonogramContext.setOffline(true)
  await nonogramPage.reload()
  await nonogramPage.getByLabel('Grid size').selectOption('5')
  await nonogramPage.getByRole('button', { name: 'New puzzle', exact: true }).tap()
  await squares.first().tap()
  assert.equal(await squares.count(), 25)
  await nonogramPage.getByRole('button', { name: 'Game menu' }).tap()
  await nonogramPage.reload()
  await nonogramPage.getByRole('button', { name: 'Resume', exact: true }).first().tap()
  assert.equal(await squares.first().getAttribute('data-mark'), '1')
  await nonogramContext.setOffline(false)
  await nonogramPage.getByRole('button', { name: 'Game menu' }).tap()
  await until(async () => {
    const progress = await request('/api/progress', { headers: playbackHeaders })
    return progress.sessions.some(item => item.data.game === 'nonograms' && item.data.board[0] === 1 &&
      progress.levels.some(level => level.id === item.data.level && level.source === 'Generated' && level.content.rows.length === 5))
  }, 'offline Nonograms Quick Play sync')
  await nonogramContext.close()
  const otherDevice = await browser.newContext()
  await otherDevice.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const otherPage = await otherDevice.newPage()
  await otherPage.goto(origin + '/games/nonograms')
  await otherPage.getByRole('button', { name: 'Resume', exact: true }).first().click()
  assert.equal(await otherPage.locator('.nonogram-cell').first().getAttribute('data-mark'), '1')
  await otherDevice.close()

  if (adminToken) {
    const studio = await browser.newContext()
    await studio.addCookies([{ name: 'aviarium', value: adminToken, url: origin }])
    const author = await studio.newPage()
    await author.goto(origin + '/studio/nonograms')
    await author.getByLabel('Pack title', { exact: true }).fill('Nonograms browser pack')
    await author.getByRole('button', { name: 'New pack', exact: true }).click()
    await author.getByRole('button', { name: 'Add level', exact: true }).click()
    await author.getByLabel('Puzzle title', { exact: true }).fill('One dot')
    await author.getByRole('button', { name: 'Row 3, column 3', exact: true }).click()
    await author.getByRole('button', { name: 'Test play', exact: true }).click()
    await author.locator('.nonogram-play .nonogram-cell').nth(12).waitFor()
    await author.goBack()
    await author.getByRole('button', { name: 'Test play', exact: true }).waitFor()
    await author.getByRole('button', { name: 'Test play', exact: true }).click()
    await author.locator('.nonogram-play .nonogram-cell').nth(12).click()
    await author.getByRole('heading', { name: 'Puzzle solved' }).waitFor()
    await author.getByRole('button', { name: 'Back to editor', exact: true }).first().click()
    await author.getByRole('button', { name: 'Publish pack', exact: true }).click()
    await author.getByRole('button', { name: 'Publish to catalog', exact: true }).click()
    await until(async () => (await request(nonogramApi + '/packs', { headers: playbackHeaders }))
      .some(pack => pack.data.title === 'Nonograms browser pack' && pack.data.puzzles[0].title === 'One dot'),
    'Nonograms pack published from Studio')
    await author.goBack()
    await author.getByRole('heading', { name: 'My packs' }).waitFor()
    await author.goBack()
    await author.getByRole('heading', { name: 'Studio', exact: true }).waitFor()
    await author.goBack()
    await author.getByRole('heading', { name: 'Game library' }).waitFor()
    await studio.close()
  }
  console.info('Nonograms checks passed: shared pack and progress routes, validation, Studio publishing, drag, and offline Quick Play sync.')

  const navigationContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await navigationContext.addCookies([{ name: 'aviarium', value: playbackToken, url: origin }])
  const navigationPage = await navigationContext.newPage()
  await navigationPage.goto(origin)
  await navigationPage.getByRole('button', { name: 'Explore Sudoku' }).click()
  await navigationPage.getByRole('button', { name: /^Budgies/ }).click()
  await navigationPage.getByRole('button', { name: /^(Play|Replay|Resume) Garden Perch/ }).click()
  await navigationPage.getByLabel('Sudoku board', { exact: true }).waitFor()
  await navigationPage.goBack()
  await navigationPage.getByRole('heading', { name: 'Budgies', exact: true }).waitFor()
  await navigationPage.goBack()
  await navigationPage.getByRole('button', { name: 'Exit to library' }).waitFor()
  await navigationPage.goBack()
  await navigationPage.getByRole('heading', { name: 'Game library' }).waitFor()

  await navigationPage.getByRole('button', { name: 'Explore Sudoku' }).click()
  await navigationPage.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await navigationPage.getByLabel('Sudoku board', { exact: true }).waitFor()
  await navigationPage.getByRole('button', { name: 'Back to roadmap', exact: true }).click()
  await navigationPage.getByRole('heading', { name: 'Budgies', exact: true }).waitFor()
  await navigationPage.getByRole('button', { name: 'Sudoku menu', exact: true }).click()
  await navigationPage.getByRole('button', { name: 'Exit to library' }).click()
  await navigationPage.getByRole('heading', { name: 'Game library' }).waitFor()

  const navigationPack = (await request('/api/games/sudoku/packs', { headers: playbackHeaders }))
    .find(item => item.id === 'budgies')
  await navigationPage.goto(`${origin}/games/sudoku/packs/budgies/${navigationPack.revision}`)
  await navigationPage.getByRole('heading', { name: 'Budgies', exact: true }).waitFor()
  await navigationPage.goBack()
  await navigationPage.getByRole('button', { name: 'Exit to library' }).waitFor()
  await navigationPage.goBack()
  await navigationPage.getByRole('heading', { name: 'Game library' }).waitFor()
  await navigationContext.close()
  console.info('Layered history checks passed: game, roadmap, menu, and library in both directions.')

  console.info('Browser checks passed: mobile controls, notes, history, keyboard, pause, e-reader, offline reload and resume', adminToken ? ', studio and admin' : '', playerToken ? ', two-browser sync' : '')
} finally {
  await browser.close()
}
