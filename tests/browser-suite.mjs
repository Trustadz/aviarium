import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'

const baseDatabase = process.env.AVIARIUM_BROWSER_TEST_DATABASE_URL
if (!baseDatabase) throw new Error('Set AVIARIUM_BROWSER_TEST_DATABASE_URL to a disposable PostgreSQL server.')
const admin = new pg.Client({ connectionString: baseDatabase })
const databases = []
let app

async function isolatedDatabase() {
  const name = 'aviarium_browser_' + randomUUID().replaceAll('-', '')
  await admin.query('CREATE DATABASE ' + name)
  databases.push(name)
  const url = new URL(baseDatabase)
  url.pathname = '/' + name
  return url.href
}

function start(args, env) {
  return spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'inherit' })
}

async function run(file, env) {
  const [code] = await once(start([file], env), 'exit')
  if (code !== 0) throw new Error(file + ' failed.')
}

async function stopApp() {
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = once(app, 'exit')
    app.kill('SIGTERM')
    await exited
  }
}

const digest = value => createHash('sha256').update(value).digest('hex')

await admin.connect()
try {
  await run('tests/studio-migration.mjs', { AVIARIUM_STUDIO_TEST_DATABASE_URL: await isolatedDatabase() })
  await run('tests/oidc-smoke.mjs', { AVIARIUM_OIDC_TEST_DATABASE_URL: await isolatedDatabase(), TEST_ENVIRONMENT: 'false' })
  await run('tests/localization-smoke.mjs', { AVIARIUM_I18N_TEST_DATABASE_URL: await isolatedDatabase() })

  const database = await isolatedDatabase()
  const origin = 'http://127.0.0.1:4183'
  app = start(['dist/apps/server/src/app.js'], {
    DATABASE_URL: database, HOST: '127.0.0.1', PORT: '4183', PUBLIC_ORIGIN: origin,
    LOGIN_ENABLED: 'true', TEST_ENVIRONMENT: 'false', OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '',
    OIDC_CALLBACK_URL: '',
  })
  for (let attempt = 0; ; attempt++) {
    if ((await fetch(origin + '/health/ready').catch(() => undefined))?.ok) break
    if (app.exitCode !== null || app.signalCode !== null || attempt >= 60)
      throw new Error('The browser test server did not start.')
    await delay(200)
  }

  const fixtures = new pg.Client({ connectionString: database })
  await fixtures.connect()
  const tokens = { admin: randomUUID(), player: randomUUID(), player2: randomUUID() }
  try {
    for (const [role, name, token] of [['admin', 'Test Admin', tokens.admin], ['user', 'Test Player', tokens.player], ['user', 'Test Player Two', tokens.player2]]) {
      const { rows: [user] } = await fixtures.query(
        "INSERT INTO users(issuer,subject,name,role) VALUES ('browser-fixture',$1,$2,$3) RETURNING id", [token, name, role])
      await fixtures.query(
        "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [digest(token), user.id])
    }
  } finally {
    await fixtures.end()
  }
  await run('tests/smoke.mjs', {
    AVIARIUM_TEST_URL: origin, AVIARIUM_TEST_ADMIN: tokens.admin, AVIARIUM_TEST_PLAYER: tokens.player,
  })
  await run('tests/leaderboards-smoke.mjs', {
    AVIARIUM_TEST_URL: origin, AVIARIUM_TEST_ADMIN: tokens.admin, AVIARIUM_TEST_PLAYER: tokens.player,
    AVIARIUM_TEST_PLAYER2: tokens.player2, AVIARIUM_TEST_DATABASE_URL: database,
    AVIARIUM_CHROMIUM: process.env.AVIARIUM_CHROMIUM,
  })
} finally {
  await stopApp()
  try {
    for (const name of databases) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)')
  } finally {
    await admin.end()
  }
}
