import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment, transaction } from './config.js'

const headerImagePattern = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/

const postInput = z.strictObject({
  category: z.enum(['update', 'content', 'game']),
  title: z.string().trim().min(1).max(120),
  intro: z.string().trim().min(1).max(600).optional(),
  body: z.string().trim().max(3000).default(''),
  headerImage: z.string().max(220_000).regex(headerImagePattern).optional(),
  headerAlt: z.string().trim().max(160).default(''),
}).refine(post => post.intro || post.body, { message: 'Enter an introduction.' })
const postId = z.object({ id: z.uuid() })

export function registerNews(app: FastifyInstance) {
  app.get('/api/news', async request => {
    const viewer = loginEnabled || testEnvironment ? await requireUser(request) : undefined
    const page = z.object({ offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0) }).parse(request.query)
    const { rows } = await pool.query(`SELECT p.id,p.category,p.title,coalesce(p.intro,p.body) AS intro,
      CASE WHEN p.intro IS NULL THEN '' ELSE p.body END AS body,
      p.header_image IS NOT NULL AS "hasHeaderImage",p.header_alt AS "headerAlt",p.published_at AS "publishedAt",
      count(l.user_id)::int AS likes, coalesce(bool_or(l.user_id=$1), false) AS liked
      FROM (SELECT * FROM news_posts WHERE is_test=$2 ORDER BY published_at DESC,id DESC LIMIT 21 OFFSET $3) p
      LEFT JOIN news_likes l ON l.post_id=p.id GROUP BY p.id,p.category,p.title,p.intro,p.body,p.header_alt,(p.header_image IS NOT NULL),p.published_at
      ORDER BY p.published_at DESC,p.id DESC`, [viewer?.id ?? null, testEnvironment, page.offset])
    return { posts: rows.slice(0, 20), more: rows.length > 20 }
  })
  app.post('/api/news', async (request, reply) => {
    await requireUser(request, 'admin')
    const post = postInput.parse(request.body)
    await pool.query(`INSERT INTO news_posts(category,title,intro,body,header_image,header_alt,is_test)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [post.category, post.title, post.intro ?? null, post.body, post.headerImage ?? null, post.headerAlt, testEnvironment])
    return reply.code(201).send({ published: true })
  })
  app.get('/api/news/:id/header-image', async (request, reply) => {
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { id } = postId.parse(request.params)
    const result = await pool.query<{ header_image: string | null }>(
      'SELECT header_image FROM news_posts WHERE id=$1 AND is_test=$2', [id, testEnvironment])
    const image = result.rows[0]?.header_image?.match(headerImagePattern)
    if (!image) throw new HttpError(404, 'Header image not found.')
    return reply.type(image[1]).send(Buffer.from(image[2], 'base64'))
  })
  app.delete('/api/news/:id', async (request, reply) => {
    await requireUser(request, 'admin')
    const { id } = postId.parse(request.params)
    const result = await pool.query('DELETE FROM news_posts WHERE id=$1 AND is_test=$2', [id, testEnvironment])
    if (!result.rowCount) throw new HttpError(404, 'Announcement not found.')
    return reply.code(204).send()
  })
  app.put('/api/news/:id/like', async request => {
    const viewer = await requireUser(request)
    const { id } = postId.parse(request.params)
    const { liked } = z.strictObject({ liked: z.boolean() }).parse(request.body)
    return transaction(async db => {
      const post = await db.query('SELECT id FROM news_posts WHERE id=$1 AND is_test=$2 FOR UPDATE', [id, testEnvironment])
      if (!post.rowCount) throw new HttpError(404, 'Announcement not found.')
      if (liked) await db.query('INSERT INTO news_likes(post_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, viewer.id])
      else await db.query('DELETE FROM news_likes WHERE post_id=$1 AND user_id=$2', [id, viewer.id])
      const result = await db.query<{ likes: number }>('SELECT count(*)::int AS likes FROM news_likes WHERE post_id=$1', [id])
      return { liked, likes: result.rows[0].likes }
    })
  })
}
