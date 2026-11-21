import { knownMessage, useT } from './i18n.js'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'
import { announcementText, announcementTranslations, type AnnouncementText, type AnnouncementTranslations } from '../../../packages/game-sdk/src/announcement.js'
import { isLocale, languageNames, locales, type Locale } from '../../../packages/game-sdk/src/locales.js'
import { ChevronDown, Heart, Trash2 } from 'lucide-react'
import { api, errorMessage, json, type SessionAccount } from './api.js'

const categories = { update: 'Aviarium update', content: 'New content', game: 'New game' } as const
interface Post {
  id: string
  category: keyof typeof categories
  locale: Locale
  title: string
  intro: string
  body: string
  hasHeaderImage: boolean
  headerAlt: string
  publishedAt: string
  likes: number
  liked: boolean
}
interface Feed { posts: Post[]; more: boolean }
interface Edit { id: string; revision: number; hasHeaderImage: boolean }
const emptyText: AnnouncementText = { title: '', intro: '', body: '', headerAlt: '' }
const emptyTranslations: AnnouncementTranslations = { en: emptyText, nl: emptyText }


async function announcementImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12_000_000)
    throw new Error('Choose a PNG, JPEG, or WebP under 12 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1200 / bitmap.width, 700 / bitmap.height)
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const drawing = canvas.getContext('2d')
    if (!drawing) throw new Error('Could not prepare the header image.')
    drawing.fillStyle = '#f4f1de'
    drawing.fillRect(0, 0, canvas.width, canvas.height)
    drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const image = canvas.toDataURL('image/jpeg', .78)
    const result = image.length <= 220_000 ? image : canvas.toDataURL('image/jpeg', .58)
    if (result.length > 220_000) throw new Error('Choose a smaller header image.')
    return result
  } finally {
    bitmap.close()
  }
}

export function News({ account, online }: { account?: SessionAccount; online: boolean }) {
  const t = useT()
  const { locale, formatDate } = useIntl()
  const [feed, setFeed] = useState<Feed>()
  const [problem, setProblem] = useState('')
  const [pending, setPending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [headerImage, setHeaderImage] = useState<string>()
  const [edit, setEdit] = useState<Edit>()
  const [texts, setTexts] = useState(emptyTranslations)
  const [sourceLocale, setSourceLocale] = useState<Locale>('en')
  const [aiEnabled, setAiEnabled] = useState(false)
  const [job, setJob] = useState<{ id: string; target: Locale }>()
  const [translated, setTranslated] = useState(false)
  const accountId = account?.id
  const canCompose = online && account?.role === 'admin'
  const working = pending || Boolean(job)

  useEffect(() => {
    if (!canCompose) return
    const request = new AbortController()
    void api<{ enabled: boolean }>('/news/translation-config', { signal: request.signal }, accountId)
      .then(result => setAiEnabled(result.enabled)).catch(() => setAiEnabled(false))
    return () => request.abort()
  }, [accountId, canCompose])

  useEffect(() => {
    if (!job || !online) return
    const { id, target } = job
    const request = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await api<{ status: 'queued' | 'running' | 'failed' | 'complete'; result: AnnouncementText | null }>(
          '/news/translation-jobs/' + id, { signal: request.signal }, accountId)
        if (request.signal.aborted) return
        if (result.status === 'queued' || result.status === 'running') {
          timer = setTimeout(poll, 1000)
          return
        }
        const translation = result.result
        if (result.status === 'complete' && translation) {
          setTexts(current => ({ ...current, [target]: translation }))
          setTranslated(true)
        } else setProblem('AI translation failed. Try again or enter the translation manually.')
        setJob(undefined)
      } catch (error) {
        if (request.signal.aborted) return
        setProblem(errorMessage(error))
        setJob(undefined)
      }
    }
    void poll()
    return () => { request.abort(); clearTimeout(timer) }
  }, [accountId, job, online])

  function openComposer(nextEdit?: Edit, initial = emptyTranslations) {
    setEdit(nextEdit)
    setTexts(initial)
    setHeaderImage(undefined)
    setTranslated(false)
    setProblem('')
    setComposing(true)
  }

  function changeText(language: Locale, field: keyof AnnouncementText, value: string) {
    setTexts(current => ({ ...current, [language]: { ...current[language], [field]: value } }))
  }
  const getFeed = useCallback((offset = 0, signal?: AbortSignal) =>
    api<Feed>('/news?locale=' + locale + '&offset=' + offset, { signal }, accountId), [accountId, locale])

  useEffect(() => {
    if (!online) return
    setFeed(undefined)
    const request = new AbortController()
    void getFeed(0, request.signal).then(result => {
      if (!request.signal.aborted) { setFeed(result); setProblem('') }
    }).catch(error => {
      if (!request.signal.aborted) setProblem(errorMessage(error))
    })
    return () => request.abort()
  }, [getFeed, online])

  function run(action: () => Promise<void>) {
    setPending(true)
    setProblem('')
    void action().catch(error => setProblem(errorMessage(error))).finally(() => setPending(false))
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = announcementTranslations.safeParse(texts)
    if (!validation.success) {
      setProblem(validation.error.issues[0]?.message ?? 'Invalid request.')
      return
    }
    const fields = new FormData(event.currentTarget)
    run(async () => {
      if (edit) await api('/news/' + edit.id + '/translations', json('PUT', { revision: edit.revision, translations: validation.data }), accountId)
      else await api('/news', json('POST', { category: fields.get('category'), translations: validation.data, headerImage }), accountId)
      setComposing(false)
      setFeed(await getFeed())
    })
  }

  function generateTranslation() {
    const target = sourceLocale === 'en' ? 'nl' : 'en'
    if (Object.values(texts[target]).some(Boolean) && !confirm(t('Replace the existing translation draft?'))) return
    run(async () => {
      const { id } = await api<{ id: string }>('/news/translation-jobs',
        json('POST', { locale: sourceLocale, source: texts[sourceLocale] }), accountId)
      setTranslated(false)
      setJob({ id, target })
    })
  }

  return <section className="news-page" aria-labelledby="news-heading">
    <div className="section-heading"><h1 id="news-heading">{t('What’s new')}</h1>
      {canCompose && <button className="secondary" disabled={working} onClick={() => {
        if (composing) setComposing(false)
        else openComposer()
      }} aria-expanded={composing}>
        {composing ? t('Cancel announcement') : t('New announcement')}
      </button>}
    </div>
    {composing && canCompose && <form className="panel news-compose" onSubmit={publish}>
      {!edit && <>
        <label>{t('Category')}<select name="category" disabled={working}>{Object.entries(categories).map(([value, label]) =>
          <option value={value} key={value}>{t(label)}</option>)}</select></label>
        <label>{t('Header image (optional)')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={working} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) run(async () => { setHeaderImage(await announcementImage(file)) })
        }}/></label>
        {headerImage && <>
          <img className="news-image-preview" src={headerImage} alt={t('Header image preview')}/>
          <button type="button" className="text-button" disabled={working} onClick={() => {
            setHeaderImage(undefined)
            setTexts(current => ({ en: { ...current.en, headerAlt: '' }, nl: { ...current.nl, headerAlt: '' } }))
          }}>{t('Remove header image')}</button>
        </>}
      </>}
      {edit?.hasHeaderImage && <img className="news-image-preview" alt={t('Header image preview')}
        src={'/api/news/' + edit.id + '/header-image'}/>}
      {locales.map(language => <fieldset className="news-locale-fields" key={language} disabled={working}>
        <legend lang={language}>{languageNames[language]}</legend>
        <label>{t('Title')}<input lang={language} required maxLength={120} value={texts[language].title}
          onChange={event => changeText(language, 'title', event.target.value)}/></label>
        <label>{t('Intro paragraph')}<textarea lang={language} required rows={3} maxLength={600} value={texts[language].intro}
          onChange={event => changeText(language, 'intro', event.target.value)}/></label>
        <label>{t('More text (optional)')}<textarea lang={language} rows={5} maxLength={3000} value={texts[language].body}
          onChange={event => changeText(language, 'body', event.target.value)}/></label>
        {(headerImage || edit?.hasHeaderImage) && <label>{t('Image description (optional)')}
          <input lang={language} maxLength={160} value={texts[language].headerAlt}
            onChange={event => changeText(language, 'headerAlt', event.target.value)}/>
        </label>}
      </fieldset>)}
      {aiEnabled && <div className="button-bar">
        <label>{t('Translate from')}<select value={sourceLocale} disabled={working}
          onChange={event => { if (isLocale(event.target.value)) setSourceLocale(event.target.value) }}>
          {locales.map(language => <option lang={language} key={language} value={language}>{languageNames[language]}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={working || !announcementText.safeParse(texts[sourceLocale]).success}
          onClick={generateTranslation}>{t('Draft translation with AI')}</button>
      </div>}
      {job && <p role="status">{t('Drafting translation…')}</p>}
      {translated && <p role="status">{t('Review the AI translation before publishing.')}</p>}
      <button className="primary" disabled={working || !locales.every(language => announcementText.safeParse(texts[language]).success)}>
        {t(edit ? 'Publish changes' : 'Publish announcement')}
      </button>
    </form>}
    {problem && <p className="notice" role="alert">{knownMessage(t, problem)}</p>}
    {!online && <p>{t("Connect to the server for the latest announcements.")}</p>}
    {online && !feed && !problem && <p role="status">{t("Loading announcements…")}</p>}
    {online && feed?.posts.length === 0 && <p>{t("No announcements yet.")}</p>}
    <div className="news-feed">{feed?.posts.map(post => <article key={post.id} className="panel news-post">
      {post.hasHeaderImage && <img className="news-header-image" src={'/api/news/' + post.id + '/header-image'}
        lang={post.locale} alt={post.headerAlt} loading="lazy" width={1200} height={675}/>}
      <div className="news-post-content">
        <p className="news-meta"><span>{t(categories[post.category])}</span>
          <time dateTime={post.publishedAt}>{formatDate(new Date(post.publishedAt), { dateStyle: 'medium' })}</time></p>
        <h2 lang={post.locale}>{post.title}</h2>
        <p className="news-body" lang={post.locale}>{post.intro}</p>
        {post.body && <details className="news-more">
          <summary><ChevronDown size={16}/><span className="news-expand">{t("Read more")}</span><span className="news-collapse">{t("Show less")}</span></summary>
          <p className="news-body" lang={post.locale}>{post.body}</p>
        </details>}
        <div className="button-bar">
          {account ? <button className="secondary" disabled={pending || !online} aria-pressed={post.liked}
            aria-label={post.liked ? t("Unlike announcement") : t("Like announcement")} onClick={() => run(async () => {
              const reaction = await api<Pick<Post, 'liked' | 'likes'>>('/news/' + post.id + '/like',
                json('PUT', { liked: !post.liked }), accountId)
              setFeed(current => current && { ...current, posts: current.posts.map(item => item.id === post.id ? { ...item, ...reaction } : item) })
            })}><Heart size={17} fill={post.liked ? 'currentColor' : 'none'}/> {post.liked ? t("Liked") : t("Like")} <span>{post.likes}</span></button>
            : <span className="news-likes"><Heart size={17}/> {t('{count, plural, one {# like} other {# likes}}', { count: post.likes })}</span>}
          {canCompose && <button className="text-button" disabled={working || composing} onClick={() => run(async () => {
            const entry = await api<{ revision: number; translations: Partial<AnnouncementTranslations> }>(
              '/news/' + post.id + '/translations', undefined, accountId)
            openComposer({ id: post.id, revision: entry.revision, hasHeaderImage: post.hasHeaderImage },
              { ...emptyTranslations, ...entry.translations })
          })}>{t('Edit translations')}</button>}
          {canCompose && <button className="text-button" disabled={working || composing} onClick={() => {
            if (!confirm(t("Remove this announcement?"))) return
            run(async () => {
              await api('/news/' + post.id, { method: 'DELETE' }, accountId)
              setFeed(await getFeed())
            })
          }}><Trash2 size={15}/>{" "}{t("Remove announcement")}</button>}
        </div>
      </div>
    </article>)}</div>
    {feed?.more && online && <button className="secondary" disabled={pending} onClick={() => run(async () => {
      const older = await getFeed(feed.posts.length)
      setFeed({ more: older.more, posts: [...feed.posts, ...older.posts.filter(post => !feed.posts.some(item => item.id === post.id))] })
    })}>{t("Older announcements")}</button>}
  </section>
}
