import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const database = process.env.AVIARIUM_OIDC_TEST_DATABASE_URL
if (!database) throw new Error('Set AVIARIUM_OIDC_TEST_DATABASE_URL to a disposable PostgreSQL database.')
const port = process.env.AVIARIUM_OIDC_TEST_PORT || '4192'
const origin = 'http://127.0.0.1:' + port
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await delay(200)
  }
  throw new Error('Timed out waiting for ' + label)
}
const directory = await mkdtemp(join(tmpdir(), 'aviarium-oidc-'))
const cert = join(directory, 'tls.pem')
const key = join(directory, 'tls.key')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'],
{ stdio: 'ignore' })
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'aviarium-test', alg: 'RS256', use: 'sig' }
const clientId = 'aviarium-test'
const first = { id: randomUUID(), name: 'Alpha Test' }
const second = { id: randomUUID(), name: 'Beta Test' }
const attempts = new Map()
const observedPrompts = []
let selected = first
let issuer
function send(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
const avatarFixture = await readFile('apps/web/public/icon-192.png')
const provider = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
  const url = new URL(req.url, issuer)
  if (url.pathname === '/.well-known/openid-configuration') return send(res, {
    issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  })
  if (url.pathname === '/avatar.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(avatarFixture)
    return
  }
  if (url.pathname === '/jwks') return send(res, { keys: [jwk] })
  if (url.pathname === '/authorize') {
    const params = url.searchParams
    const code = randomUUID()
    observedPrompts.push(params.get('prompt'))
    attempts.set(code, { person: selected, nonce: params.get('nonce'), challenge: params.get('code_challenge') })
    const next = new URL(params.get('redirect_uri'))
    next.searchParams.set('state', params.get('state'))
    next.searchParams.set('code', code)
    res.writeHead(302, { Location: next.href }); res.end()
    return
  }
  if (url.pathname === '/token') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const params = new URLSearchParams(raw)
    const code = params.get('code')
    const attempt = attempts.get(code)
    if (!attempt || createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') !== attempt.challenge)
      return send(res, { error: 'invalid_grant' }, 400)
    attempts.delete(code)
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const data = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({
      iss: issuer, sub: attempt.person.id, aud: clientId, iat: now, exp: now + 120, nonce: attempt.nonce, name: attempt.person.name, picture: issuer + '/avatar.png',
    })
    return send(res, { access_token: randomUUID(), token_type: 'Bearer',
      id_token: data + '.' + sign('sha256', Buffer.from(data), signing.privateKey).toString('base64url') })
  }
  return send(res, { error: 'not_found' }, 404)
})
async function openSettings(page, name) {
  const account = page.getByRole('button', { name: /Account menu|Device menu/ })
  await account.click()
  await page.getByRole('button', { name, exact: true }).click()
}

let app, browser
async function stopApp() {
  if (!app || app.exitCode != null) return
  const exited = new Promise(resolve => app.once('exit', resolve))
  app.kill('SIGTERM')
  await exited
}

async function startApp(env) {
  await stopApp()
  app = spawn(process.execPath, ['dist/apps/server/src/app.js'], { env, stdio: 'inherit' })
  for (let i = 0; i < 60; i++) {
    const response = await fetch(origin + '/health/ready').catch(error => error)
    if (response?.ok) return
    if (app.exitCode != null || i === 59)
      throw new Error('Test application did not start: ' + (response?.status ?? response?.cause ?? response))
    await delay(200)
  }
}
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  issuer = 'https://127.0.0.1:' + provider.address().port
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert, PORT: port, HOST: '127.0.0.1',
    PUBLIC_ORIGIN: origin, DATABASE_URL: database, OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId,
    AVIARIUM_ENABLED_LOCALES: 'en',
    OIDC_CLIENT_SECRET: 'aviarium-fixture', OIDC_ADMIN_SUBJECT: first.id, OIDC_CALLBACK_URL: '' }
  delete env.LOGIN_ENABLED
  delete env.TEST_ENVIRONMENT
  execFileSync(process.execPath, ['dist/apps/server/src/migrate.js'], { env, stdio: 'inherit' })
  await startApp(env)
  browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM, args: ['--no-sandbox'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'dark', locale: 'en-US' })
  const page = await context.newPage()
  await page.goto(origin)
  await page.locator('.login-page[data-theme=dark]').waitFor()
  assert.deepEqual((await (await context.request.get(origin + '/api/locales')).json()).enabled, ['en'])
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).click()
  await page.getByRole('button', { name: 'Account menu' }).filter({ hasText: first.name }).waitFor()
  const who = async () => (await (await context.request.get(origin + '/api/me')).json()).user
  const alpha = await who()
  assert.equal(alpha.role, 'admin')
  assert.equal(alpha.avatar, issuer + '/avatar.png')
  const accountAvatar = page.getByRole('button', { name: 'Account menu' }).locator('img')
  await accountAvatar.waitFor()
  await accountAvatar.evaluate(image => image.decode())
  await openSettings(page, 'Account settings')
  await page.getByLabel('Display name').fill('Alpha Aviary')
  await page.getByLabel('Avatar').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: avatarFixture })
  await page.getByRole('button', { name: 'Save profile' }).click()
  await page.getByText('Profile saved.').waitFor()
  const customized = await who()
  assert.equal(customized.name, 'Alpha Aviary')
  assert.match(customized.avatar, /^data:image\/(webp|png);base64,/)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'News', exact: true }).click()
  const releaseTitle = 'What’s new in Aviarium 0.1.13'
  await page.getByRole('heading', { name: releaseTitle }).waitFor()
  await page.getByRole('button', { name: 'New announcement' }).click()
  await page.getByLabel('Category').selectOption('content')
  await page.getByLabel('Header image (optional)', { exact: true }).setInputFiles({
    name: 'header.png', mimeType: 'image/png', buffer: avatarFixture,
  })
  const postTitle = 'A new Sudoku pack ' + first.id.slice(0, 8)
  const english = page.getByRole('group', { name: 'English' })
  const dutch = page.getByRole('group', { name: 'Nederlands' })
  await dutch.waitFor()
  await english.getByLabel('Image description (optional)').fill('Aviarium artwork')
  await english.getByLabel('Title', { exact: true }).fill(postTitle)
  await english.getByLabel('Intro paragraph').fill('Three new puzzles are ready.')
  await english.getByLabel('More text (optional)').fill('Start with the easiest puzzle in the pack.')
  await dutch.getByLabel('Image description (optional)').fill('Aviarium-illustratie')
  await dutch.getByLabel('Title', { exact: true }).fill('Een nieuw sudokupakket')
  await dutch.getByLabel('Intro paragraph').fill('Er staan drie nieuwe puzzels klaar.')
  await dutch.getByLabel('More text (optional)').fill('Begin met de makkelijkste puzzel in het pakket.')
  await page.getByRole('button', { name: 'Publish announcement' }).click()
  const publishedPost = page.getByRole('article').filter({ hasText: postTitle })
  await publishedPost.getByRole('heading', { name: postTitle }).waitFor()
  await publishedPost.getByRole('img', { name: 'Aviarium artwork' }).evaluate(image => image.decode())
  await publishedPost.getByText('Three new puzzles are ready.').waitFor()
  const fullText = publishedPost.getByText('Start with the easiest puzzle in the pack.')
  assert.equal(await fullText.isVisible(), false)
  await publishedPost.getByText('Read more', { exact: true }).click()
  await fullText.waitFor()
  await publishedPost.getByText('Show less', { exact: true }).click()
  await fullText.waitFor({ state: 'hidden' })
  await publishedPost.getByRole('button', { name: 'Like announcement' }).click()
  await publishedPost.getByRole('button', { name: 'Unlike announcement' }).waitFor()
  await page.reload()
  await publishedPost.getByRole('button', { name: 'Unlike announcement' }).waitFor()
  await page.getByRole('link', { name: 'Library', exact: true }).click()

  const adminExport = await context.request.get(origin + '/api/packs/budgies/1/export')
  assert.equal(adminExport.status(), 200)
  const packArchive = await adminExport.body()
  await openSettings(page, 'Device settings')
  const theme = page.getByLabel('Theme')
  assert.equal(await theme.inputValue(), 'auto')
  await page.locator('.app[data-theme=dark]').waitFor()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.locator('.app[data-theme=light]').waitFor()
  await theme.selectOption('dark')
  await page.locator('.app[data-theme=dark]').waitFor()
  await theme.selectOption('auto')
  await page.locator('.app[data-theme=light]').waitFor()
  await theme.selectOption('dark')
  await page.getByLabel('E-reader mode').check()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await openSettings(page, 'Account settings')
  selected = second
  await page.getByRole('link', { name: 'Switch account' }).click()
  await page.getByRole('button', { name: 'Account menu' }).filter({ hasText: second.name }).waitFor()
  const beta = await who()
  assert.notEqual(beta.id, alpha.id)
  assert.equal(beta.role, 'user')
  assert.deepEqual(beta.editorGames, [])
  assert.equal(observedPrompts.at(-1), 'select_account')
  await page.getByRole('link', { name: 'News', exact: true }).click()
  await page.getByRole('heading', { name: postTitle }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'New announcement' }).count(), 0)
  assert.equal(await publishedPost.getByRole('button', { name: 'Like announcement' }).locator('span').textContent(), '1')
  await page.getByRole('link', { name: 'Library', exact: true }).click()

  assert.equal(await page.getByRole('button', { name: 'Add Sudoku to favorites' }).count(), 1)
  assert.equal(await page.locator('.app.reader[data-theme=dark]').count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Admin' }).count(), 0)
  await openSettings(page, 'Account settings')
  const otherTab = await context.newPage()
  await otherTab.goto(origin + '/games/sudoku')
  await otherTab.getByRole('heading', { name: 'Sudoku', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).waitFor()
  await otherTab.getByRole('link', { name: 'Login with Pocket ID', exact: true }).waitFor()
  assert.equal(await who(), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('aviarium:session')), null)
  assert.equal((await context.request.get(origin + '/api/games/sudoku/packs')).status(), 401)
  console.info('OIDC smoke passed: real callback and PKCE, role bootstrap, account selection, isolated preferences, device display, logout.')
  await otherTab.close()
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).click()
  await page.getByRole('button', { name: 'Account menu' }).filter({ hasText: second.name }).waitFor()
  const localEnv = { ...env, LOGIN_ENABLED: 'false', OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' }
  await startApp(localEnv)

  const me = await (await context.request.get(origin + '/api/me')).json()
  assert.deepEqual(me, { user: null, signIn: false, loginEnabled: false, testEnvironment: false })
  const packs = await (await context.request.get(origin + '/api/packs')).json()
  const level = packs.find(pack => pack.id === 'budgies')?.data.puzzles[0]
  assert.ok(level)
  assert.equal((await context.request.get(origin + '/api/auth/login')).status(), 404)
  for (const path of ['/api/progress', '/api/drafts', '/api/admin/backup']) {
    assert.equal((await context.request.get(origin + path)).status(), 401, path)
  }
  assert.equal((await context.request.post(origin + '/api/progress', {
    headers: { Origin: origin }, data: {},
  })).status(), 401)
  assert.equal((await context.request.patch(origin + '/api/preferences', {
    headers: { Origin: origin }, data: { timer: false },
  })).status(), 401)

  const syncRequests = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (['/api/progress', '/api/preferences'].includes(path)) syncRequests.push(path)
  })
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Account menu' }).count(), 0)
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: /^Budgies/ }).click()
  await page.getByRole('button', { name: 'Play ' + level.title }).click()
  const blank = level.grid.indexOf('0')
  const cell = cellValue => page.getByRole('button', {
    name: `Row ${Math.floor(blank / 9) + 1}, column ${blank % 9 + 1}, ${cellValue}`, exact: true,
  })
  await cell('empty').click({ timeout: 5000 }).catch(async error => {
    throw new Error('Could not open the pack puzzle. ' + (await page.locator('main').innerText()).slice(0, 500), { cause: error })
  })
  await page.getByRole('button', { name: '1', exact: true }).click()
  await cell('1').waitFor()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.reload()
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  await page.getByRole('button', { name: 'Remove Sudoku from favorites' }).waitFor()
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await cell('1').waitFor()
  assert.deepEqual(syncRequests, [])

  // A game opened from the game menu has two layers to pop: the level and the
  // menu. (A level opened from the pack roadmap has the roadmap in between.)
  const toLibrary = async () => {
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'Game library' }).waitFor()
  }
  await toLibrary()
  assert.equal(await page.getByRole('banner').getByText('Local play', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('banner').getByRole('link', { name: 'Library', exact: true }).count(), 0)
  const remove = page.getByRole('button', { name: 'Remove Sudoku download' })
  const cachedGame = () => page.evaluate(() => caches.has('aviarium-game-sudoku'))
  await page.waitForFunction(() => caches.has('aviarium-game-sudoku'))
  assert.equal(await remove.count(), 0)
  const manageInstalls = async enabled => {
    await openSettings(page, 'Device settings')
    const toggle = page.getByRole('checkbox', { name: 'Manage installs' })
    assert.equal(await toggle.isChecked(), !enabled)
    await toggle.setChecked(enabled)
    await page.getByRole('button', { name: 'Close' }).click()
  }
  await manageInstalls(true)
  await remove.waitFor()
  await manageInstalls(false)
  await remove.waitFor({ state: 'hidden' })
  assert.equal(await cachedGame(), true)
  await manageInstalls(true)

  const backgroundGame = await context.newPage()
  await backgroundGame.goto(origin + '/games/sudoku')
  await backgroundGame.getByRole('button', { name: 'Back' }).waitFor()
  await backgroundGame.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.bringToFront()
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('link', { name: 'Sudoku', exact: true }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await cell('1').waitFor()
  await toLibrary()
  await remove.click()
  await remove.waitFor({ state: 'hidden' })
  assert.equal(await cachedGame(), false)
  await page.getByRole('link', { name: 'Sudoku', exact: true }).click()
  await page.getByText('Connect to install Sudoku on this device.').waitFor()
  await page.getByRole('button', { name: 'Back' }).click()

  await context.setOffline(false)
  await backgroundGame.bringToFront()
  assert.equal(await cachedGame(), false)
  await backgroundGame.close()
  await page.getByRole('link', { name: 'Sudoku', exact: true }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await cell('1').waitFor()
  await toLibrary()
  await remove.waitFor()
  await page.evaluate(async () => {
    const cache = await caches.open('aviarium-game-sudoku')
    await cache.put('/__aviarium/last-played', new Response(String(Date.now() - 30 * 24 * 60 * 60 * 1000)))
  })

  await context.setOffline(true)
  await page.reload()
  await remove.waitFor()
  await stopApp()
  await context.setOffline(false)
  const installedWhileServerDown = await page.evaluate(() => new Promise(resolve => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = event => { port1.close(); resolve(event.data.games) }
    navigator.serviceWorker.controller.postMessage({ operation: 'check' }, [port2])
  }))
  assert.deepEqual(installedWhileServerDown, ['sudoku'])
  assert.equal(await cachedGame(), true)
  await startApp(localEnv)
  await page.reload()
  await page.waitForFunction(async () => !(await caches.has('aviarium-game-sudoku')))
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  await remove.waitFor({ state: 'hidden' })
  assert.deepEqual(syncRequests, [])
  await page.evaluate(async () => {
    const legacy = await caches.open('aviarium-000000000000')
    await legacy.put('/assets/Player-legacy.js', new Response('legacy player'))
  })
  await page.reload()
  await remove.waitFor()
  assert.equal(await page.evaluate(() => caches.has('aviarium-000000000000')), false)
  console.info('Downloads smoke passed: automatic install, offline play and removal, save preservation, and expiry only on a live connection.')

  await startApp(env)
  await page.goto(origin)
  await page.getByRole('button', { name: 'Account menu' }).filter({ hasText: second.name }).waitFor()
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).waitFor()
  const progress = await (await context.request.get(origin + '/api/progress')).json()
  assert.deepEqual(progress.sessions, [])
  assert.equal(await page.evaluate(() => localStorage.getItem('aviarium:local-play')), null)
  console.info('Local play smoke passed: stale sessions rejected, browser saves persist, no sync requests, and account data stays separate.')

  const testRoleRequest = (client, role, from = origin) => client.post(origin + '/api/auth/test-role', {
    headers: { Origin: from }, data: { role },
  })
  assert.equal((await testRoleRequest(context.request, 'admin')).status(), 404)
  await startApp({ ...localEnv, TEST_ENVIRONMENT: 'true' })
  assert.equal(await who(), null)
  assert.equal((await testRoleRequest(context.request, 'admin', 'http://unrelated.invalid')).status(), 403)
  await page.reload()
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  const testUser = await who()
  assert.notEqual(testUser.id, beta.id)
  assert.equal(testUser.testRole, 'user')
  assert.match(testUser.avatar, /^data:image\/svg\+xml;base64,/)
  await openSettings(page, 'Account settings')
  await page.getByLabel('Display name').fill('Preview Player')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await page.getByText('Profile saved.').waitFor()
  assert.equal((await who()).name, 'Preview Player')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'News', exact: true }).click()
  await page.getByRole('heading', { name: releaseTitle }).waitFor()
  assert.equal(await page.getByRole('heading', { name: postTitle }).count(), 0)
  await page.getByRole('link', { name: 'Library', exact: true }).click()

  const get = path => context.request.get(origin + path)
  assert.equal((await get('/api/drafts')).status(), 403)
  assert.equal((await get('/api/admin/users')).status(), 403)
  assert.equal((await get('/api/packs/budgies/1/export')).status(), 403)
  const importPack = () => context.request.post(origin + '/api/pack-drafts/import', {
    headers: { Origin: origin }, data: { content: packArchive.toString('base64') },
  })
  assert.equal((await importPack()).status(), 403)

  await openSettings(page, 'Device settings')
  const testRole = page.getByLabel('Test user role')
  assert.equal(await testRole.inputValue(), 'user')
  await testRole.selectOption('editor')
  const studio = page.getByRole('link', { name: 'Studio', exact: true })
  await until(async () => (await who()).role === 'editor', 'editor role from Device settings')
  const testEditor = await who()
  assert.equal(testEditor.id, testUser.id)
  assert.equal(testEditor.role, 'editor')
  assert.deepEqual(testEditor.editorGames, ['sudoku', 'nonograms'])
  assert.equal((await get('/api/games/nonograms/pack-drafts')).status(), 200)
  assert.equal((await get('/api/drafts')).status(), 200)
  assert.equal((await get('/api/admin/users')).status(), 403)
  assert.equal((await get('/api/packs/budgies/1/export')).status(), 403)
  const imported = await importPack()
  assert.equal(imported.status(), 200)
  const packDraft = await imported.json()
  assert.equal(packDraft.data.title, 'Budgies')
  assert.equal(packDraft.data.puzzles.length, 3)
  assert.equal(packDraft.published, null)
  const publishedPack = await context.request.post(origin + '/api/pack-drafts/' + packDraft.id + '/publish', {
    headers: { Origin: origin }, data: { version: packDraft.version },
  })
  assert.equal(publishedPack.status(), 200)
  const ownedExport = '/api/packs/' + packDraft.id + '/1/export'
  assert.equal((await get(ownedExport)).status(), 200)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  await studio.waitFor()
  await studio.click()
  await page.getByRole('heading', { name: 'Studio', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Create for Sudoku', exact: true }).click()
  await page.getByRole('heading', { name: 'My packs', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Budgies', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.getByRole('heading', { name: 'Studio', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openSettings(page, 'Device settings')
  await testRole.selectOption('admin')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await openSettings(page, 'Administration')
  await page.getByRole('heading', { name: 'Administration', exact: true }).waitFor()
  assert.equal((await get('/api/admin/users')).status(), 200)
  await page.reload()
  await page.getByRole('heading', { name: 'Administration', exact: true }).waitFor()
  assert.equal((await who()).id, testUser.id)
  await openSettings(page, 'Device settings')
  await testRole.selectOption('user')
  await until(async () => (await who()).role === 'user', 'user role from Device settings')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  assert.equal(await studio.count(), 0)
  assert.equal((await get('/api/drafts')).status(), 403)
  assert.equal((await get(ownedExport)).status(), 403)
  const testCookie = (await context.cookies()).find(cookie => cookie.name === 'aviarium-test')
  assert.ok(testCookie?.httpOnly)

  await startApp(env)
  await page.reload()
  await page.getByRole('button', { name: 'Account menu' }).filter({ hasText: second.name }).waitFor()
  assert.equal((await who()).id, beta.id)
  const replay = await fetch(origin + '/api/me', { headers: { Cookie: 'aviarium=' + testCookie.value } })
  assert.equal((await replay.json()).user, null)
  assert.equal((await testRoleRequest(context.request, 'admin')).status(), 404)
  console.info('Test environment smoke passed: server-side role changes, reload persistence, and separation from normal sign-in.')
} finally {
  if (browser) await browser.close()
  await stopApp()
  await new Promise(resolve => provider.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
