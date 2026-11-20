import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as openid from 'openid-client'
import { callback, oidc, origin, pool, transaction } from './config.js'

export interface User { id: string; name: string; role: 'player' | 'creator' | 'admin' }
export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const secure = origin.startsWith('https:')
const sessionCookie = secure ? '__Host-aviarium' : 'aviarium'
const cookies = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const }

export async function currentUser(request: FastifyRequest): Promise<User | undefined> {
  const cookie = request.cookies[sessionCookie]
  if (!cookie) return undefined
  const result = await pool.query<User>(`SELECT u.id,u.name,u.role FROM users u JOIN auth_sessions s
    ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(cookie)])
  return result.rows[0]
}

export async function requireUser(request: FastifyRequest, permission?: 'creator' | 'admin'): Promise<User> {
  const user = await currentUser(request)
  if (!user) throw new HttpError(401, 'Sign in to continue.')
  if (request.headers["x-aviarium-account"] && request.headers["x-aviarium-account"] !== user.id)
    throw new HttpError(409, "The active account changed. Refresh and sign in again.")
  if (permission === 'admin' && user.role !== 'admin' || permission === 'creator' && user.role === 'player')
    throw new HttpError(403, 'Your account does not have this permission.')
  return user
}

let discovery: Promise<openid.Configuration> | undefined
function provider() {
  if (!oidc) throw new HttpError(503, 'Pocket ID is not configured.')
  discovery ??= openid.discovery(new URL(oidc.issuer), oidc.id, oidc.secret).then(config => {
    // Require cryptographic signature validation on the token endpoint's ID token.
    openid.enableNonRepudiationChecks(config)
    return config
  }).catch(error => { discovery = undefined; throw error })
  return discovery
}

export function registerAuth(app: FastifyInstance) {
  app.get('/api/me', async request => ({ user: await currentUser(request) ?? null, signIn: Boolean(oidc) }))
  app.get('/api/auth/login', async (_request, reply) => {
    const config = await provider()
    const verifier = openid.randomPKCECodeVerifier()
    const state = openid.randomState()
    const nonce = openid.randomNonce()
    const attempt = token()
    await pool.query('DELETE FROM login_attempts WHERE expires_at<=now()')
    await pool.query(`INSERT INTO login_attempts(token_hash,verifier,state,nonce,expires_at)
      VALUES ($1,$2,$3,$4,now()+interval '10 minutes')`, [digest(attempt), verifier, state, nonce])
    reply.setCookie('aviarium-login', attempt, { ...cookies, maxAge: 600 })
    return reply.redirect(openid.buildAuthorizationUrl(config, {
      redirect_uri: callback.href, scope: 'openid profile', state, nonce,
      code_challenge: await openid.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
    }).href)
  })
  app.get('/api/auth/callback', async (request, reply) => {
    const cookie = request.cookies['aviarium-login']
    reply.clearCookie('aviarium-login', cookies)
    if (!cookie) throw new HttpError(400, 'This sign-in request expired. Start again.')
    const attempt = (await pool.query<{verifier: string; state: string; nonce: string}>(`DELETE FROM login_attempts
      WHERE token_hash=$1 AND expires_at>now() RETURNING verifier,state,nonce`, [digest(cookie)])).rows[0]
    if (!attempt) throw new HttpError(400, 'This sign-in request expired. Start again.')
    const config = await provider()
    const url = new URL(callback)
    url.search = new URL(request.url, origin).search
    const result = await openid.authorizationCodeGrant(config, url, {
      pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true,
    }).catch(() => { throw new HttpError(400, 'Pocket ID sign-in failed. Start again.') })
    const claims = result.claims()
    if (!claims?.sub) throw new HttpError(400, 'Pocket ID returned no user identity.')
    const name = [claims.name, claims.preferred_username].find(value => typeof value === 'string')
    const session = token()
    await transaction(async db => {
      const { rows: [user] } = await db.query<{id: string}>(`INSERT INTO users(issuer,subject,name) VALUES($1,$2,$3)
        ON CONFLICT (issuer,subject) DO UPDATE SET name=excluded.name RETURNING id`,
      [claims.iss, claims.sub, typeof name === 'string' ? name.slice(0, 120) : 'Player'])
      await db.query('DELETE FROM auth_sessions WHERE expires_at<=now() OR token_hash=$1', [digest(request.cookies[sessionCookie] ?? '')])
      await db.query(`INSERT INTO auth_sessions(token_hash,user_id,expires_at)
        VALUES($1,$2,now()+interval '14 days')`, [digest(session), user.id])
    })
    reply.setCookie(sessionCookie, session, { ...cookies, maxAge: 14 * 86400 })
    return reply.redirect('/')
  })
  app.post('/api/auth/logout', async (request, reply) => {
    const cookie = request.cookies[sessionCookie]
    if (cookie) await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(cookie)])
    return reply.clearCookie(sessionCookie, cookies).code(204).send()
  })
}
