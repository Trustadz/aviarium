import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { validate } from '../dist/packages/sudoku/src/solver.js'
import { rules } from '../dist/packages/sudoku/src/rules.js'

const origin = process.env.AVIARIUM_TEST_URL || 'http://localhost:4183'
const adminToken = process.env.AVIARIUM_TEST_ADMIN
const playerToken = process.env.AVIARIUM_TEST_PLAYER
const adminHeaders = adminToken ? { Cookie: 'aviarium=' + adminToken } : {}
const playerHeaders = playerToken ? { Cookie: 'aviarium=' + playerToken } : {}

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
const starting = await request('/api/catalog')
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

  const job = await request('/api/jobs', { method: 'POST', headers: adminHeaders,
    body: { kind: 'generate', options: { seed: 'aviarium-v1:first-light', difficulty: 'Easy', unique: true } } })
  const jobResult = async id => until(async () => {
    const current = (await request('/api/jobs', { headers: adminHeaders })).find(item => item.id === id)
    return current?.status === 'complete' && current.result
  }, 'server puzzle job')
  const generated = await jobResult(job.id)
  assert.equal(generated.grid, selected.grid)
  const draft = await request('/api/drafts', { method: 'POST', headers: adminHeaders,
    body: { grid: generated.grid, title: updatedTitle, generationJob: job.id } })
  const verifyDraft = draft => request('/api/jobs', { method: 'POST', headers: adminHeaders,
    body: { kind: 'validate', draftId: draft.id, version: draft.version } })
  const validation = await verifyDraft(draft)
  const verified = await jobResult(validation.id)
  assert.equal(verified.kind, 'unique')
  assert.equal(verified.steps.length, level.filter(value => !value).length)
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
  assert.deepEqual(await request('/api/catalog'), await request('/api/catalog', { headers: playerHeaders }))
  await request('/api/admin/levels/' + published.id, { method: 'PATCH', headers: adminHeaders, body: { hidden: true } })
  assert.ok(!(await request('/api/catalog')).some(level => level.id === published.id))
  await request('/api/admin/levels/' + published.id, { method: 'PATCH', headers: adminHeaders, body: { hidden: false } })
  assert.ok((await request('/api/catalog')).some(level => level.id === published.id))

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
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Sudoku', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await page.getByRole('link', { name: 'Sudoku', exact: true }).waitFor()
  if (process.env.AVIARIUM_SCREENSHOTS) await page.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/library-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('dialog', { name: 'Account' }).waitFor()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Display settings' }).click()
  await page.getByLabel('Theme').selectOption('dark')
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark')
  assert.equal(await page.getByLabel('Show timer').count(), 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.reload()
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark')
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: 'Sudoku settings' }).click()
  await page.getByLabel('Show timer').uncheck()
  assert.equal(await page.getByLabel('Theme').count(), 0)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('button', { name: 'Download for offline' }).click()
  await page.getByRole('button', { name: 'Available offline' }).waitFor()
  await page.getByRole('button', { name: 'Play First Light' }).click()
  const firstBlank = level.indexOf(0)
  const cell = (value) => page.getByRole('button', { name: `Row ${Math.floor(firstBlank / 9) + 1}, column ${firstBlank % 9 + 1}, ${value}`, exact: true })
  await cell('empty').tap()
  await page.getByRole('button', { name: 'Notes' }).tap()
  await page.getByRole('button', { name: '6', exact: true }).tap()
  await cell('empty').getByText('6', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Undo' }).tap()
  assert.equal(await cell('empty').textContent(), '')
  await page.getByRole('button', { name: 'Redo' }).tap()
  await cell('empty').getByText('6', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Notes' }).tap()
  await cell('empty').press(String(solution[firstBlank]))
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByRole('heading', { name: 'Game paused' }).waitFor()
  await page.getByRole('button', { name: 'Resume game' }).tap()
  await page.getByRole('button', { name: 'Display settings' }).tap()
  await page.getByLabel('E-reader mode').check()
  await page.getByRole('button', { name: 'Close' }).tap()
  assert.equal(await page.locator('.reader').count(), 1)
  await page.getByRole('button', { name: 'Puzzle list' }).tap()
  await context.setOffline(true)
  await page.reload()
  await page.locator('.app.reader[data-theme=dark]').waitFor()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().tap()
  await cell(String(solution[firstBlank])).waitFor()
  if (process.env.AVIARIUM_SCREENSHOTS) await page.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/player-reader-mobile.png', fullPage: true })
  assert.deepEqual(pageErrors, [])
  if (adminToken) {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 945 } })
    await desktop.addCookies([{ name: 'aviarium', value: adminToken, url: origin }])
    const adminPage = await desktop.newPage()
    await adminPage.goto(origin)
    await adminPage.getByRole('link', { name: 'Studio' }).click()
    await adminPage.getByRole('heading', { name: 'Creator studio' }).waitFor()
    await adminPage.getByLabel('Draft title').fill('Browser check')
    await adminPage.getByRole('button', { name: 'Test on server' }).click()
    await adminPage.getByRole('status').filter({ hasText: 'Valid · multiple solutions' }).waitFor()
    await adminPage.getByRole('button', { name: 'Step through' }).click()
    await adminPage.getByRole('button', { name: 'Next step' }).click()
    await adminPage.getByText('1 / 81').waitFor()
    if (process.env.AVIARIUM_SCREENSHOTS) await adminPage.screenshot({ path: process.env.AVIARIUM_SCREENSHOTS + '/studio-desktop.png', fullPage: true })
    await adminPage.getByRole('link', { name: 'Admin' }).click()
    await adminPage.getByRole('heading', { name: 'Administration' }).waitFor()
    await adminPage.getByRole('button', { name: 'Run now' }).waitFor()
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
    await deviceA.goto(origin + '/games/sudoku')
    await deviceA.getByRole('button', { name: 'Test Player' }).waitFor()
    await deviceA.getByRole('button', { name: 'Play Quiet Current' }).click()
    const label = `Row ${Math.floor(blank / 9) + 1}, column ${blank % 9 + 1}, `
    await deviceA.getByRole('button', { name: label + 'empty', exact: true }).press(String(digit))
    await deviceA.getByRole('button', { name: 'Puzzle list' }).click()
    await until(async () => {
      const progress = await request('/api/progress', { headers: playerHeaders })
      return progress.sessions.some(item => item.data.level === quiet.id && item.data.board.entries[blank] === digit)
    }, 'device A progress upload')
    const deviceB = await second.newPage()
    await deviceB.goto(origin + '/games/sudoku')
    const savedRow = deviceB.locator('.attempts .level-row').filter({ hasText: 'Quiet Current' })
    await savedRow.getByRole('button', { name: 'Resume' }).first().click()
    await deviceB.getByRole('button', { name: label + digit, exact: true }).waitFor()
    await first.close()
    await second.close()
  }
  console.info('Browser checks passed: mobile controls, notes, history, keyboard, pause, e-reader, offline reload and resume', adminToken ? ', studio and admin' : '', playerToken ? ', two-browser sync' : '')
} finally {
  await browser.close()
}
