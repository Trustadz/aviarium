import { apiMessages, type ApiCode } from '../../../packages/game-sdk/src/api-messages.js'
import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as openid from 'openid-client'
import { z } from 'zod'
import { accountRoles, canEditGames, type AccountRole } from '../../../packages/game-sdk/src/roles.js'
import { serverGames } from './games.js'
import { callback, loginEnabled, oidc, origin, pool, testEnvironment, transaction } from './config.js'

export interface User { id: string; name: string; role: AccountRole }
export const accountRoleSchema = z.enum(accountRoles)
interface SessionUser extends User {
  expiresAt: Date
  testRole?: AccountRole
  avatar?: string | null
  pocketAvatar?: string | null
  customAvatar?: boolean
}
const profileInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  avatar: z.string().max(120_000).regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(),
})
export const userFields = 'u.id,COALESCE(u.display_name,u.name) AS name,u.role'

// Older installed clients read editorGames until their application shell updates.
export function withLegacyEditorGames<T extends User>(user: T) {
  return { ...user, editorGames: canEditGames(user.role) ? [...serverGames.keys()] : [] }
}
export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: ApiCode, readonly values: Record<string, string> = {}) {
    super(apiMessages[code].replace(/\{(\w+)\}/g, (placeholder, key) => values[key] ?? placeholder))
  }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const secure = origin.startsWith('https:')
const testIssuer = 'aviarium:test'
const cookieName = testEnvironment ? 'aviarium-test' : 'aviarium'
const sessionCookie = secure ? '__Host-' + cookieName : cookieName
const cookies = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const }

export async function currentUser(request: FastifyRequest, withProfile = false): Promise<SessionUser | undefined> {
  const cookie = request.cookies[sessionCookie]
  if ((!loginEnabled && !testEnvironment) || !cookie) return undefined
  const result = await pool.query<SessionUser>(`SELECT ${userFields}, s.expires_at AS "expiresAt"
    ${withProfile ? ', COALESCE(u.custom_avatar,u.pocket_avatar) AS avatar, u.pocket_avatar AS "pocketAvatar", (u.custom_avatar IS NOT NULL) AS "customAvatar"' : ''}
    FROM users u JOIN auth_sessions s
    ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND (u.issuer=$2)=$3`, [digest(cookie), testIssuer, testEnvironment])
  const user = result.rows[0]
  if (user && testEnvironment) {
    user.testRole = user.role
    if (withProfile) {
      user.pocketAvatar = '/aviarium.svg'
      user.avatar ??= user.pocketAvatar
    }
  }
  return user
}

export async function requireUser(request: FastifyRequest, permission?: 'admin'): Promise<User> {
  const user = await currentUser(request)
  if (!user) throw new HttpError(401, 'sign_in_required')
  if (request.headers["x-aviarium-account"] && request.headers["x-aviarium-account"] !== user.id)
    throw new HttpError(409, 'active_account_changed')
  if (permission === 'admin' && user.role !== 'admin')
    throw new HttpError(403, 'permission_denied')
  return user
}

export async function requireEditor(request: FastifyRequest): Promise<User> {
  const user = await requireUser(request)
  if (!canEditGames(user.role))
    throw new HttpError(403, 'game_edit_denied')
  return user
}

export const pocketAvatarOrigin = oidc ? URL.parse(oidc.issuer)?.origin : undefined

let discovery: Promise<openid.Configuration> | undefined
function provider() {
  if (!oidc) throw new HttpError(503, 'oidc_unconfigured')
  discovery ??= openid.discovery(new URL(oidc.issuer), oidc.id, oidc.secret).then(config => {
    // Require cryptographic signature validation on the token endpoint's ID token.
    openid.enableNonRepudiationChecks(config)
    return config
  }).catch(error => { discovery = undefined; throw error })
  return discovery
}

export function registerAuth(app: FastifyInstance) {
  app.get('/api/me', async request => {
    const user = await currentUser(request, true)
    return { user: user ? withLegacyEditorGames(user) : null, signIn: Boolean(oidc), loginEnabled, testEnvironment }
  })
  if (loginEnabled || testEnvironment) {
    app.patch('/api/me/profile', async (request, reply) => {
      const user = await requireUser(request)
      const { name, avatar } = profileInput.parse(request.body)
      if (avatar === undefined) await pool.query('UPDATE users SET display_name=$1 WHERE id=$2', [name, user.id])
      else await pool.query('UPDATE users SET display_name=$1,custom_avatar=$2 WHERE id=$3', [name, avatar, user.id])
      return reply.code(204).send()
    })
  }
  if (testEnvironment) {
    app.post('/api/auth/test-role', async (request, reply) => {
      const { role } = z.object({ role: accountRoleSchema }).parse(request.body)
      const cookie = request.cookies[sessionCookie]
      const next = await transaction(async db => {
        const current = cookie ? (await db.query<{id: string}>(`SELECT u.id FROM users u JOIN auth_sessions s ON s.user_id=u.id
          WHERE s.token_hash=$1 AND s.expires_at>now() AND u.issuer=$2 FOR UPDATE OF u`, [digest(cookie), testIssuer])).rows[0] : undefined
        const expectedId = request.headers['x-aviarium-account']
        if (expectedId && current?.id !== expectedId)
          throw new HttpError(409, 'test_session_changed')
        const user = current ?? (await db.query<{id: string}>(`INSERT INTO users(issuer,subject,name,role)
          VALUES($1,$2,'Test user',$3) RETURNING id`, [testIssuer, token(), role])).rows[0]
        if (current) await db.query('UPDATE users SET role=$1 WHERE id=$2', [role, user.id])
        if (current) return undefined
        const session = token()
        await db.query('DELETE FROM auth_sessions WHERE expires_at<=now()')
        await db.query(`INSERT INTO auth_sessions(token_hash,user_id,expires_at)
          VALUES($1,$2,now()+interval '14 days')`, [digest(session), user.id])
        return session
      })
      if (next) reply.setCookie(sessionCookie, next, { ...cookies, maxAge: 14 * 86400 })
      return reply.code(204).send()
    })
    return
  }
  if (!loginEnabled) return
  app.get('/api/auth/login', async (request, reply) => {
    const config = await provider()
    const selectAccount = (request.query as { switch?: string }).switch === '1'
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
      ...(selectAccount ? { prompt: 'select_account' } : {}),
      code_challenge: await openid.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
    }).href)
  })
  app.get('/api/auth/callback', async (request, reply) => {
    const cookie = request.cookies['aviarium-login']
    reply.clearCookie('aviarium-login', cookies)
    if (!cookie) throw new HttpError(400, 'sign_in_expired')
    const attempt = (await pool.query<{verifier: string; state: string; nonce: string}>(`DELETE FROM login_attempts
      WHERE token_hash=$1 AND expires_at>now() RETURNING verifier,state,nonce`, [digest(cookie)])).rows[0]
    if (!attempt) throw new HttpError(400, 'sign_in_expired')
    const config = await provider()
    const url = new URL(callback)
    url.search = new URL(request.url, origin).search
    const result = await openid.authorizationCodeGrant(config, url, {
      pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true,
    }).catch(() => { throw new HttpError(400, 'sign_in_failed') })
    const claims = result.claims()
    if (!claims?.sub) throw new HttpError(400, 'sign_in_missing_identity')
    let picture: string | null = null
    if (typeof claims.picture === 'string' && claims.picture.length <= 2048) {
      const candidate = URL.parse(claims.picture)
      if (candidate && candidate.origin === pocketAvatarOrigin && !candidate.username && !candidate.password)
        picture = candidate.href
    }
    const name = [claims.name, claims.preferred_username].find(value => typeof value === 'string')
    const session = token()
    const initialRole = claims.sub === process.env.OIDC_ADMIN_SUBJECT ? 'admin' : 'user'
    await transaction(async db => {
      const { rows: [user] } = await db.query<{id: string}>(`INSERT INTO users(issuer,subject,name,role,pocket_avatar) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT (issuer,subject) DO UPDATE SET name=excluded.name,pocket_avatar=excluded.pocket_avatar,
          role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END RETURNING id`,
      [claims.iss, claims.sub, typeof name === 'string' ? name.slice(0, 120) : 'Player', initialRole, picture])
      await db.query('DELETE FROM auth_sessions WHERE expires_at<=now() OR token_hash=$1', [digest(request.cookies[sessionCookie] ?? '')])
      await db.query(`INSERT INTO auth_sessions(token_hash,user_id,expires_at)
        VALUES($1,$2,now()+interval '14 days')`, [digest(session), user.id])
    })
    reply.setCookie(sessionCookie, session, { ...cookies, maxAge: 14 * 86400 })
    return reply.redirect('/')
  })
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.headers['x-aviarium-account']) await requireUser(request)
    const cookie = request.cookies[sessionCookie]
    if (cookie) await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(cookie)])
    return reply.clearCookie(sessionCookie, cookies).code(204).send()
  })
}
