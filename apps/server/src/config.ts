import pg from 'pg'

const loginFlag = process.env.LOGIN_ENABLED ?? 'true'
if (loginFlag !== 'true' && loginFlag !== 'false') throw new Error('LOGIN_ENABLED must be true or false')
export const loginEnabled = loginFlag === 'true'
const testFlag = process.env.TEST_ENVIRONMENT ?? 'false'
if (testFlag !== 'true' && testFlag !== 'false') throw new Error('TEST_ENVIRONMENT must be true or false')
export const testEnvironment = testFlag === 'true'
const pocketIdEnabled = loginEnabled && !testEnvironment

const { DATABASE_URL, PUBLIC_ORIGIN, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_CALLBACK_URL } = process.env
export const pool = new pg.Pool({
  connectionString: DATABASE_URL || undefined, max: 8, connectionTimeoutMillis: 3000, application_name: 'aviarium',
})
pool.on('error', error => console.error(JSON.stringify({ event: 'database_connection_lost', type: error.name })))
const publicUrl = new URL(PUBLIC_ORIGIN || 'http://localhost:4173')
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && loopback))
  throw new Error('PUBLIC_ORIGIN must use HTTPS except on the loopback host')
if (testEnvironment && !loopback) throw new Error('TEST_ENVIRONMENT requires a loopback PUBLIC_ORIGIN')
const publishedHost = process.env.APP_BIND
export const listenHost = process.env.HOST || (testEnvironment ? '127.0.0.1' : '0.0.0.0')
if (testEnvironment && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(publishedHost || listenHost))
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
