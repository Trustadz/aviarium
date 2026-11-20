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
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  issuer = 'https://127.0.0.1:' + provider.address().port
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert, PORT: port, HOST: '127.0.0.1',
    PUBLIC_ORIGIN: origin, DATABASE_URL: database, OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: 'aviarium-fixture', OIDC_ADMIN_SUBJECT: first.id, OIDC_CALLBACK_URL: '' }
  execFileSync(process.execPath, ['dist/apps/server/src/migrate.js'], { env, stdio: 'inherit' })
  app = spawn(process.execPath, ['dist/apps/server/src/app.js'], { env, stdio: 'inherit' })
  for (let i = 0; i < 60; i++) {
    const response = await fetch(origin + '/health/ready').catch(error => error)
    if (response?.ok) break
    if (app.exitCode != null || i === 59)
      throw new Error('OIDC test application did not start: ' + (response?.status ?? response?.cause ?? response))
    await delay(200)
  }
  browser = await chromium.launch({ executablePath: process.env.AVIARIUM_CHROMIUM, args: ['--no-sandbox'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto(origin)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('link', { name: 'Sign in with Pocket ID' }).click()
  await page.getByRole('button', { name: first.name }).waitFor()
  const who = async () => (await (await context.request.get(origin + '/api/me')).json()).user
  const alpha = await who()
  assert.equal(alpha.role, 'admin')
  await page.getByRole('button', { name: 'Display settings' }).click()
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
  assert.equal(beta.role, 'player')
  assert.equal(observedPrompts.at(-1), 'select_account')
  assert.equal(await page.getByRole('button', { name: 'Add Sudoku to favorites' }).count(), 1)
  assert.equal(await page.locator('.app.reader[data-theme=dark]').count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Admin' }).count(), 0)
  await page.getByRole('button', { name: second.name }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
  assert.equal(await who(), null)
  console.info('OIDC smoke passed: real callback and PKCE, role bootstrap, account selection, isolated preferences, device display, logout.')
} finally {
  if (browser) await browser.close()
  if (app && app.exitCode == null) {
    const exited = new Promise(resolve => app.once('exit', resolve))
    app.kill('SIGTERM')
    await exited
  }
  await new Promise(resolve => provider.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
