import pg from 'pg'

const { DATABASE_URL, PUBLIC_ORIGIN, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_CALLBACK_URL } = process.env
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8, application_name: 'aviarium' })
const publicUrl = new URL(PUBLIC_ORIGIN || 'http://localhost:4173')
if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)))
  throw new Error('PUBLIC_ORIGIN must use HTTPS except on the loopback host')
export const origin = publicUrl.origin
export const callback = new URL(OIDC_CALLBACK_URL || '/api/auth/callback', origin)
if (callback.origin !== origin || callback.pathname !== '/api/auth/callback' || callback.search || callback.hash)
  throw new Error('OIDC callback must be /api/auth/callback on PUBLIC_ORIGIN')
export const oidc = OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET
  ? { issuer: OIDC_ISSUER, id: OIDC_CLIENT_ID, secret: OIDC_CLIENT_SECRET }
  : undefined
if ((OIDC_ISSUER || OIDC_CLIENT_ID || OIDC_CLIENT_SECRET) && !oidc) throw new Error('All OIDC credentials are required')

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
