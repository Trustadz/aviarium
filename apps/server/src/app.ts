import { fileURLToPath, pathToFileURL } from 'node:url'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import { apiMessages, type ApiCode } from '../../../packages/game-sdk/src/api-messages.js'
import { ZodError } from 'zod'
import { HttpError, pocketAvatarOrigin, registerAuth } from './auth.js'
import { runBackups } from './backup-runner.js'
import { registerBackups } from './backups.js'
import { enabledLocales, listenHost, origin, pool } from './config.js'
import { registerNews } from './news.js'
import { runNewsTranslations } from './news-translation.js'
import { createServerGames } from './games.js'
import { registerLeaderboards } from './leaderboards.js'
import { registerPacks } from './packs.js'
import { registerProgress } from './progress.js'
import { migrate } from './migrate.js'
import { runPuzzleJobs } from './worker.js'

export async function makeApp() {
  const serverGames = createServerGames()
  const app = Fastify({
    logger: {
      serializers: {
        req: (req: {method: string; url: string}) => ({ method: req.method, url: req.url.split('?')[0] }),
      },
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    disableRequestLogging: true,
    bodyLimit: 256 * 1024,
  })
  await app.register(cookie)
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin')
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:" + (pocketAvatarOrigin ? ' ' + pocketAvatarOrigin : '') + "; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== origin)
      throw new HttpError(403, 'origin_denied')
  })
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? apiMessages.invalid_request
      const code = (Object.keys(apiMessages) as ApiCode[]).find(key => apiMessages[key] === message) ?? 'invalid_request'
      return reply.code(400).send({ error: message, code })
    }
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message, code: error.code, values: error.values })
    const failure = error as { statusCode?: number; code?: string; name?: string }
    if (failure.statusCode && failure.statusCode < 500)
      return reply.code(failure.statusCode).send({ error: apiMessages.request_failed, code: 'request_failed' })
    request.log.error({ code: failure.code, type: failure.name }, 'Request failed')
    return reply.code(500).send({ error: apiMessages.server_error, code: 'server_error' })
  })
  app.get('/api/locales', async () => ({ enabled: enabledLocales }))
  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_, reply) => {
    try { await pool.query('SELECT 1 FROM migrations LIMIT 1'); return { status: 'ok' } }
    catch { return reply.code(503).send({ status: 'unavailable' }) }
  })
  registerAuth(app)
  registerNews(app)
  for (const game of serverGames.values()) {
    game.routes(app)
    registerPacks(app, game, '/api/games/' + game.id)
    if (game.id === 'sudoku') registerPacks(app, game, '/api')
  }
  registerProgress(app, serverGames)
  registerLeaderboards(app, serverGames)
  registerBackups(app)
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../../../../dist/web/', import.meta.url)),
    setHeaders(res, path) {
      res.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    },
  })
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0].replace(/\/$/, '')
    const game = /^\/(?:games|studio)\/([a-z0-9-]+)(?:\/|$)/.exec(path)?.[1]
    const standalonePage = ['', '/news', '/about', '/leaderboards', '/studio', '/studio/packs', '/admin'].includes(path)
    if (request.method === 'GET' && (standalonePage || (game && serverGames.has(game))))
      return reply.sendFile('index.html')
    return reply.code(404).send({ error: apiMessages.not_found, code: 'not_found' })
  })
  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop.abort())
  await migrate()
  const app = await makeApp()
  try {
    await app.listen({ host: listenHost, port: Number(process.env.PORT || 4173) })
    const jobs = runPuzzleJobs(stop.signal)
    const translations = runNewsTranslations(stop.signal)
    const backups = runBackups(stop.signal)
    try { await Promise.all([jobs, backups, translations]) }
    finally {
      stop.abort()
      await Promise.allSettled([jobs, backups, translations, app.close()])
    }
  } finally {
    await pool.end()
  }
}
