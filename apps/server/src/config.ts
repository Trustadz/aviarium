import { isLocale, locales } from '../../../packages/game-sdk/src/locales.js'
import pg from 'pg'
import { validTimeZone } from './challenges/time.js'

const loginFlag = process.env.LOGIN_ENABLED ?? 'true'
if (loginFlag !== 'true' && loginFlag !== 'false') throw new Error('LOGIN_ENABLED must be true or false')
export const loginEnabled = loginFlag === 'true'
const testFlag = process.env.TEST_ENVIRONMENT ?? 'false'
if (testFlag !== 'true' && testFlag !== 'false') throw new Error('TEST_ENVIRONMENT must be true or false')
export const testEnvironment = testFlag === 'true'
const allowLanTest = testEnvironment && process.env.TEST_ENVIRONMENT_ALLOW_LAN === 'true'
const pocketIdEnabled = loginEnabled && !testEnvironment

const challengesFlag = process.env.CHALLENGES_ENABLED ?? 'true'
if (challengesFlag !== 'true' && challengesFlag !== 'false') throw new Error('CHALLENGES_ENABLED must be true or false')
/** Emergency kill switch. The database series switch is the graceful pause. */
export const challengesEnabled = challengesFlag === 'true'
export const challengeTimeZone = process.env.CHALLENGE_TIMEZONE ?? 'UTC'
if (!validTimeZone(challengeTimeZone))
  throw new Error('CHALLENGE_TIMEZONE must be a valid IANA timezone')

const { DATABASE_URL, PUBLIC_ORIGIN, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_CALLBACK_URL } = process.env
export const pool = new pg.Pool({
  connectionString: DATABASE_URL || undefined, max: 8, connectionTimeoutMillis: 3000, application_name: 'aviarium',
})
pool.on('error', error => console.error(JSON.stringify({ event: 'database_connection_lost', type: error.name })))
const publicUrl = new URL(PUBLIC_ORIGIN || 'http://localhost:4173')
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
if (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:')
  throw new Error('PUBLIC_ORIGIN must use HTTP or HTTPS')
if (testEnvironment && !allowLanTest && !loopback) throw new Error('TEST_ENVIRONMENT requires a loopback PUBLIC_ORIGIN')
const publishedHost = process.env.APP_BIND
export const listenHost = process.env.HOST || (testEnvironment && !allowLanTest ? '127.0.0.1' : '0.0.0.0')
if (testEnvironment && !allowLanTest && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(publishedHost || listenHost))
  throw new Error('TEST_ENVIRONMENT requires a loopback listener or Docker port binding')
export const origin = publicUrl.origin
export const callback = new URL((pocketIdEnabled && OIDC_CALLBACK_URL) || '/api/auth/callback', origin)
if (callback.origin !== origin || callback.pathname !== '/api/auth/callback' || callback.search || callback.hash)
  throw new Error('OIDC callback must be /api/auth/callback on PUBLIC_ORIGIN')
export const oidc = pocketIdEnabled && OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET
  ? { issuer: OIDC_ISSUER, id: OIDC_CLIENT_ID, secret: OIDC_CLIENT_SECRET }
  : undefined
if (pocketIdEnabled && (OIDC_ISSUER || OIDC_CLIENT_ID || OIDC_CLIENT_SECRET) && !oidc) throw new Error('All OIDC credentials are required')

export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const configuredLocales = (process.env.AVIARIUM_ENABLED_LOCALES ?? locales.join(',')).split(',').map(value => value.trim())
if (!configuredLocales.every(isLocale) || new Set(configuredLocales).size !== configuredLocales.length)
  throw new Error('AVIARIUM_ENABLED_LOCALES must list one or both of en and nl without duplicates')
export const enabledLocales = configuredLocales
