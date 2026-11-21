import type { PoolClient } from 'pg'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { announcementText, announcementTranslations, type AnnouncementTranslations } from '../../../packages/game-sdk/src/announcement.js'
import { locales } from '../../../packages/game-sdk/src/locales.js'
import { HttpError, requireUser } from './auth.js'
import { enabledLocales, loginEnabled, pool, testEnvironment, transaction } from './config.js'
import { translationEnabled } from './news-translation.js'

const headerImagePattern = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
const postInput = z.strictObject({
  category: z.enum(['update', 'content', 'game']),
  translations: announcementTranslations,
  headerImage: z.string().max(220_000).regex(headerImagePattern).optional(),
})
const updateInput = z.strictObject({ revision: z.number().int().positive(), translations: announcementTranslations })
const postId = z.object({ id: z.uuid() })

async function writeTranslations(db: PoolClient, id: string, translations: AnnouncementTranslations) {
  for (const locale of locales) {
    const { title, intro, body, headerAlt } = translations[locale]
    await db.query(`INSERT INTO news_translations(post_id,locale,title,intro,body,header_alt) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (post_id,locale) DO UPDATE SET title=excluded.title,intro=excluded.intro,
      body=excluded.body,header_alt=excluded.header_alt`, [id, locale, title, intro, body, headerAlt])
  }
}

export function registerNews(app: FastifyInstance) {
  app.get('/api/news', async request => {
    const viewer = loginEnabled || testEnvironment ? await requireUser(request) : undefined
    const page = z.object({ offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
      locale: z.enum(locales).optional() }).parse(request.query)
    const locale = page.locale && enabledLocales.includes(page.locale) ? page.locale : enabledLocales[0]
    const { rows } = await pool.query(`SELECT p.id,p.category,t.title,t.intro,t.body,t.locale,t.header_alt AS "headerAlt",
      p.header_image IS NOT NULL AS "hasHeaderImage",p.published_at AS "publishedAt",
      (SELECT count(*)::int FROM news_likes WHERE post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM news_likes WHERE post_id=p.id AND user_id=$1) AS liked
      FROM (SELECT * FROM news_posts WHERE is_test=$2 ORDER BY published_at DESC,id DESC LIMIT 21 OFFSET $3) p
      JOIN LATERAL (
        SELECT * FROM news_translations WHERE post_id=p.id ORDER BY (locale=$4) DESC, locale LIMIT 1
      ) t ON true ORDER BY p.published_at DESC,p.id DESC`, [viewer?.id ?? null, testEnvironment, page.offset, locale])
    return { posts: rows.slice(0, 20), more: rows.length > 20 }
  })
  app.post('/api/news', async (request, reply) => {
    await requireUser(request, 'admin')
    const post = postInput.parse(request.body)
    await transaction(async db => {
      const { rows: [created] } = await db.query<{id: string}>(`INSERT INTO news_posts(category,header_image,is_test)
        VALUES ($1,$2,$3) RETURNING id`, [post.category, post.headerImage ?? null, testEnvironment])
      await writeTranslations(db, created.id, post.translations)
    })
    return reply.code(201).send({ published: true })
  })
  app.get('/api/news/translation-config', async request => {
    await requireUser(request, 'admin')
    return { enabled: translationEnabled }
  })
  app.post('/api/news/translation-jobs', async (request, reply) => {
    const admin = await requireUser(request, 'admin')
    if (!translationEnabled) throw new HttpError(503, 'ai_translation_unconfigured')
    const { locale, source } = z.strictObject({ locale: z.enum(locales), source: announcementText }).parse(request.body)
    const id = await transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [admin.id])
      await db.query("DELETE FROM news_translation_jobs WHERE user_id=$1 AND created_at < now()-interval '1 day'", [admin.id])
      const { rows: [usage] } = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM news_translation_jobs
        WHERE user_id=$1 AND created_at>now()-interval '1 hour'`, [admin.id])
      if (usage.total >= 12) throw new HttpError(429, 'ai_translation_limit')
      const { rows: [job] } = await db.query<{id: string}>(`INSERT INTO news_translation_jobs(user_id,source_locale,source)
        VALUES ($1,$2,$3) RETURNING id`, [admin.id, locale, source])
      return job.id
    })
    return reply.code(202).send({ id })
  })
  app.get('/api/news/translation-jobs/:id', async request => {
    const admin = await requireUser(request, 'admin')
    const { id } = postId.parse(request.params)
    const { rows: [job] } = await pool.query(`SELECT status,result FROM news_translation_jobs WHERE id=$1 AND user_id=$2`, [id, admin.id])
    if (!job) throw new HttpError(404, 'ai_translation_not_found')
    return job
  })
  app.get('/api/news/:id/translations', async request => {
    await requireUser(request, 'admin')
    const { id } = postId.parse(request.params)
    const { rows: [post] } = await pool.query(`SELECT p.revision,jsonb_object_agg(t.locale,
      jsonb_build_object('title',t.title,'intro',t.intro,'body',t.body,'headerAlt',t.header_alt)) AS translations
      FROM news_posts p JOIN news_translations t ON t.post_id=p.id WHERE p.id=$1 AND p.is_test=$2
      GROUP BY p.id`, [id, testEnvironment])
    if (!post) throw new HttpError(404, 'announcement_not_found')
    return post
  })
  app.put('/api/news/:id/translations', async request => {
    await requireUser(request, 'admin')
    const { id } = postId.parse(request.params)
    const { revision, translations } = updateInput.parse(request.body)
    await transaction(async db => {
      const update = await db.query(`UPDATE news_posts SET revision=revision+1 WHERE id=$1 AND is_test=$2 AND revision=$3`,
        [id, testEnvironment, revision])
      if (!update.rowCount) throw new HttpError(409, 'announcement_save_conflict')
      await writeTranslations(db, id, translations)
    })
    return { published: true }
  })
  app.get('/api/news/:id/header-image', async (request, reply) => {
    if (loginEnabled || testEnvironment) await requireUser(request)
    const { id } = postId.parse(request.params)
    const result = await pool.query<{ header_image: string | null }>(
      'SELECT header_image FROM news_posts WHERE id=$1 AND is_test=$2', [id, testEnvironment])
    const image = result.rows[0]?.header_image?.match(headerImagePattern)
    if (!image) throw new HttpError(404, 'announcement_image_not_found')
    return reply.type(image[1]).send(Buffer.from(image[2], 'base64'))
  })
  app.delete('/api/news/:id', async (request, reply) => {
    await requireUser(request, 'admin')
    const { id } = postId.parse(request.params)
    const result = await pool.query('DELETE FROM news_posts WHERE id=$1 AND is_test=$2', [id, testEnvironment])
    if (!result.rowCount) throw new HttpError(404, 'announcement_not_found')
    return reply.code(204).send()
  })
  app.put('/api/news/:id/like', async request => {
    const viewer = await requireUser(request)
    const { id } = postId.parse(request.params)
    const { liked } = z.strictObject({ liked: z.boolean() }).parse(request.body)
    return transaction(async db => {
      const post = await db.query('SELECT id FROM news_posts WHERE id=$1 AND is_test=$2 FOR UPDATE', [id, testEnvironment])
      if (!post.rowCount) throw new HttpError(404, 'announcement_not_found')
      if (liked) await db.query('INSERT INTO news_likes(post_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, viewer.id])
      else await db.query('DELETE FROM news_likes WHERE post_id=$1 AND user_id=$2', [id, viewer.id])
      const result = await db.query<{ likes: number }>('SELECT count(*)::int AS likes FROM news_likes WHERE post_id=$1', [id])
      return { liked, likes: result.rows[0].likes }
    })
  })
}
