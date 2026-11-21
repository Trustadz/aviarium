import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { generateQuickPuzzle } from '../dist/packages/sudoku/src/quick-play.js'
import { validate } from '../dist/packages/sudoku/src/solver.js'
import { rules } from '../dist/packages/sudoku/src/rules.js'

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

if (adminToken && playerToken) {
  await request('/api/drafts', { headers: playerHeaders, expected: 403 })
  await request('/api/admin/backup', { headers: playerHeaders, expected: 403 })
  await request('/api/admin/backup', { method: 'POST', headers: { ...adminHeaders, Origin: 'https://example.org' }, expected: 403 })

  const member = (await request('/api/me', { headers: playerHeaders })).user
  assert.equal(member.role, 'user')
  assert.deepEqual(member.editorGames, [])
  const accessPath = '/api/admin/users/' + member.id
  const editorPatch = enabled => ({ editor: 'sudoku', enabled })
  await request(accessPath, { method: 'PATCH', headers: playerHeaders, body: editorPatch(true), expected: 403 })
  await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: { ...editorPatch(true), editor: 'unknown' }, expected: 400 })
  const editor = await request(accessPath, { method: 'PATCH', headers: adminHeaders, body: editorPatch(true) })
  assert.equal(editor.role, 'user')
  assert.deepEqual(editor.editorGames, ['sudoku'])
  await request('/api/drafts', { headers: playerHeaders })
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
  const published = await request('/api/drafts/' + draft.id + '/publish', {
    method: 'POST', headers: adminHeaders, body: { jobId: validation.id },
  })
  assert.equal(published.revision, 1)
  const nextDraft = await request('/api/drafts/' + draft.id, { method: 'PUT', headers: adminHeaders,
    body: { title: updatedTitle + ' Revised', grid: generated.grid, version: draft.version } })
  await request('/api/drafts/' + draft.id + '/publish', { method: 'POST', expected: 409,
    headers: adminHeaders, body: { jobId: validation.id } })
  const nextJob = await verifyDraft(nextDraft)
  await jobResult(nextJob.id)
  const second = await request('/api/drafts/' + draft.id + '/publish', { method: 'POST', headers: adminHeaders,
    body: { jobId: nextJob.id } })
  assert.equal(second.revision, 2)
  assert.deepEqual(await request('/api/catalog', { headers: adminHeaders }), await request('/api/catalog', { headers: playerHeaders }))
  await request('/api/admin/levels/' + published.id, { method: 'PATCH', headers: adminHeaders, body: { hidden: true } })
  assert.ok(!(await request('/api/catalog', { headers: adminHeaders })).some(level => level.id === published.id))
  await request('/api/admin/levels/' + published.id, { method: 'PATCH', headers: adminHeaders, body: { hidden: false } })
  assert.ok((await request('/api/catalog', { headers: adminHeaders })).some(level => level.id === published.id))

  const sessionId = crypto.randomUUID()
  const initial = { game: 'sudoku', format: 1, ruleset: 1, level: selected.id, levelRevision: selected.revision,
    board: rules.create(level), undo: [], redo: [], elapsedMs: 0, completed: false }
  const save = (data, baseRevision) => ({ data, sessionId, baseRevision, mutationId: crypto.randomUUID(), archived: false })
  const push = (body, expected = 200) => request('/api/progress', { headers: playerHeaders, method: 'POST', body, expected })
  const raw = save(initial, 0)
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
  const cardSurface = await page.locator('.game-card').evaluate(card => getComputedStyle(card).backgroundColor)
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
    await adminPage.getByRole('link', { name: 'Studio' }).click()
    await adminPage.getByRole('link', { name: 'Open workspace' }).click()
    await adminPage.getByRole('heading', { name: 'Creator studio' }).waitFor()
    await adminPage.getByLabel('Draft title').fill('Browser check')
    await adminPage.getByRole('button', { name: 'Test on server' }).click()
    await adminPage.getByRole('status').filter({ hasText: 'Valid · multiple solutions' }).waitFor()
    assert.equal(await adminPage.getByRole('button', { name: 'Publish', exact: true }).count(), 0)
    await adminPage.locator('input[type=file]').setInputFiles({
      name: 'first-light.txt', mimeType: 'text/plain', buffer: Buffer.from(selected.grid),
    })
    await adminPage.getByRole('button', { name: 'Test on server' }).click()
    await adminPage.getByRole('status').filter({ hasText: 'Valid · unique solution' }).waitFor()
    await adminPage.getByRole('button', { name: 'Step through' }).click()
    await adminPage.getByRole('button', { name: 'Next step' }).click()
    await adminPage.getByText(/^1 \/ \d+/).waitFor()
    if (process.env.AVIARIUM_SCREENSHOTS) await adminPage.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/studio-desktop.png', fullPage: true })
    await adminPage.getByRole('navigation', { name: 'Main navigation' }).waitFor()
    await openSettings(adminPage, 'Administration')
    await adminPage.getByRole('heading', { name: 'Administration' }).waitFor()
    await adminPage.getByRole('button', { name: 'Run now' }).waitFor()
    if (playerToken) {
      const users = await request('/api/admin/users', { headers: adminHeaders })
      const member = (await request('/api/me', { headers: playerHeaders })).user
      const person = users.find(item => item.id === member.id)
      const grant = adminPage.getByRole('checkbox', { name: 'Sudoku editor for ' + person.name })
      await grant.click()
      await until(async () => {
        const result = await request('/api/me', { headers: playerHeaders })
        return result.user.editorGames.includes('sudoku')
      }, 'Sudoku editor grant from Admin')
      const editorContext = await browser.newContext()
      await editorContext.addCookies([{ name: 'aviarium', value: playerToken, url: origin }])
      const editorPage = await editorContext.newPage()
      await editorPage.goto(origin)
      await editorPage.getByRole('link', { name: 'Studio' }).click()
      await editorPage.getByRole('link', { name: 'Open workspace' }).click()
      await editorPage.getByRole('heading', { name: 'Creator studio' }).waitFor()
      await editorPage.getByRole('button', { name: 'Account menu' }).click()
      assert.equal(await editorPage.getByRole('button', { name: 'Administration' }).count(), 0)
      await editorContext.close()
      await grant.click()
      await until(async () => {
        const result = await request('/api/me', { headers: playerHeaders })
        return !result.user.editorGames.includes('sudoku')
      }, 'Sudoku editor revocation from Admin')
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
    assert.deepEqual(await deviceB.locator('.sudoku-menu > section').evaluateAll(sections =>
      sections.map(section => section.querySelector('h2')?.textContent)), ['Continue', 'Quick Play', 'Packs'])
    assert.match(await savedCell.getAttribute('class'), /entry/)
    await savedRow.getByRole('button', { name: 'Resume' }).first().click()
    await deviceB.getByRole('button', { name: label + digit, exact: true }).waitFor()
    await first.close()
    await second.close()
  }
  console.info('Browser checks passed: mobile controls, notes, history, keyboard, pause, e-reader, offline reload and resume', adminToken ? ', studio and admin' : '', playerToken ? ', two-browser sync' : '')
} finally {
  await browser.close()
}
