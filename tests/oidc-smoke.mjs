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
const provider = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
  const url = new URL(req.url, issuer)
  if (url.pathname === '/.well-known/openid-configuration') return send(res, {
    issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  })
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
      iss: issuer, sub: attempt.person.id, aud: clientId, iat: now, exp: now + 120, nonce: attempt.nonce, name: attempt.person.name,
    })
    return send(res, { access_token: randomUUID(), token_type: 'Bearer',
      id_token: data + '.' + sign('sha256', Buffer.from(data), signing.privateKey).toString('base64url') })
  }
  return send(res, { error: 'not_found' }, 404)
})
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
    OIDC_CLIENT_SECRET: 'aviarium-fixture', OIDC_ADMIN_SUBJECT: first.id, OIDC_CALLBACK_URL: '' }
  delete env.LOGIN_ENABLED
  execFileSync(process.execPath, ['dist/apps/server/src/migrate.js'], { env, stdio: 'inherit' })
  await startApp(env)
  browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM, args: ['--no-sandbox'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto(origin)
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).click()
  await page.getByRole('button', { name: first.name }).waitFor()
  const who = async () => (await (await context.request.get(origin + '/api/me')).json()).user
  const alpha = await who()
  assert.equal(alpha.role, 'admin')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Theme').selectOption('dark')
  await page.getByLabel('E-reader mode').check()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await page.getByRole('button', { name: first.name }).click()
  selected = second
  await page.getByRole('link', { name: 'Switch account' }).click()
  await page.getByRole('button', { name: second.name }).waitFor()
  const beta = await who()
  assert.notEqual(beta.id, alpha.id)
  assert.equal(beta.role, 'user')
  assert.deepEqual(beta.editorGames, [])
  assert.equal(observedPrompts.at(-1), 'select_account')
  assert.equal(await page.getByRole('button', { name: 'Add Sudoku to favorites' }).count(), 1)
  assert.equal(await page.locator('.app.reader[data-theme=dark]').count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Admin' }).count(), 0)
  await page.getByRole('button', { name: second.name }).click()
  const otherTab = await context.newPage()
  await otherTab.goto(origin + '/games/sudoku')
  await otherTab.getByRole('heading', { name: 'Sudoku', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).waitFor()
  await otherTab.getByRole('link', { name: 'Login with Pocket ID', exact: true }).waitFor()
  assert.equal(await who(), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('aviarium:session')), null)
  assert.equal((await context.request.get(origin + '/api/catalog')).status(), 401)
  console.info('OIDC smoke passed: real callback and PKCE, role bootstrap, account selection, isolated preferences, device display, logout.')
  await otherTab.close()
  await page.getByRole('link', { name: 'Login with Pocket ID', exact: true }).click()
  await page.getByRole('button', { name: second.name }).waitFor()
  const localEnv = { ...env, LOGIN_ENABLED: 'false', OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' }
  await startApp(localEnv)

  const me = await (await context.request.get(origin + '/api/me')).json()
  assert.deepEqual(me, { user: null, signIn: false, loginEnabled: false })
  const catalog = await (await context.request.get(origin + '/api/catalog')).json()
  const level = catalog.find(level => level.id === 'first-light')
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
  assert.equal(await page.getByRole('button', { name: second.name }).count(), 0)
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).click()
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: 'Play First Light' }).click()
  const blank = level.grid.indexOf('0')
  const cell = cellValue => page.getByRole('button', {
    name: `Row ${Math.floor(blank / 9) + 1}, column ${blank % 9 + 1}, ${cellValue}`, exact: true,
  })
  await cell('empty').click()
  await page.getByRole('button', { name: '1', exact: true }).click()
  await cell('1').waitFor()
  await page.getByRole('button', { name: 'Game menu' }).click()
  await page.getByRole('button', { name: 'Exit to library' }).click()
  await page.reload()
  await page.getByRole('heading', { name: 'Game library' }).waitFor()
  await page.getByRole('button', { name: 'Remove Sudoku from favorites' }).waitFor()
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await cell('1').waitFor()
  assert.deepEqual(syncRequests, [])

  const toLibrary = async () => {
    await page.getByRole('button', { name: 'Game menu' }).click()
    await page.getByRole('button', { name: 'Exit to library' }).click()
  }
  await toLibrary()
  assert.equal(await page.getByRole('banner').getByText('Local play', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('banner').getByRole('link', { name: 'Library', exact: true }).count(), 0)
  const remove = page.getByRole('button', { name: 'Remove Sudoku download' })
  const cachedGame = () => page.evaluate(() => caches.has('aviarium-game-sudoku'))
  await remove.waitFor()
  assert.equal(await cachedGame(), true)

  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  await cell('1').waitFor()
  await toLibrary()
  await remove.click()
  await remove.waitFor({ state: 'hidden' })
  assert.equal(await cachedGame(), false)
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
  await page.getByText('Connect to install Sudoku on this device.').waitFor()
  await page.getByRole('button', { name: 'Exit to library' }).click()

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Explore Sudoku' }).click()
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
  console.info('Downloads smoke passed: automatic install, offline play and removal, save preservation, and expiry only on a live connection.')

  await startApp(env)
  await page.goto(origin)
  await page.getByRole('button', { name: second.name }).waitFor()
  await page.getByRole('button', { name: 'Add Sudoku to favorites' }).waitFor()
  const progress = await (await context.request.get(origin + '/api/progress')).json()
  assert.deepEqual(progress.sessions, [])
  assert.equal(await page.evaluate(() => localStorage.getItem('aviarium:local-play')), null)
  console.info('Local play smoke passed: stale sessions rejected, browser saves persist, no sync requests, and account data stays separate.')
} finally {
  if (browser) await browser.close()
  await stopApp()
  await new Promise(resolve => provider.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
