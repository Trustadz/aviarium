import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronDown, Heart, Trash2 } from 'lucide-react'
import { api, errorMessage, json, type SessionAccount } from './api.js'

const categories = { update: 'Aviarium update', content: 'New content', game: 'New game' } as const
interface Post {
  id: string
  category: keyof typeof categories
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
  const [feed, setFeed] = useState<Feed>()
  const [problem, setProblem] = useState('')
  const [pending, setPending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [headerImage, setHeaderImage] = useState<string>()
  const accountId = account?.id
  const getFeed = useCallback((offset = 0, signal?: AbortSignal) =>
    api<Feed>('/news?offset=' + offset, { signal }, accountId), [accountId])

  useEffect(() => {
    if (!online) return
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
    const fields = new FormData(event.currentTarget)
    run(async () => {
      await api('/news', json('POST', { ...Object.fromEntries(fields), headerImage }), accountId)
      setComposing(false)
      setHeaderImage(undefined)
      setFeed(await getFeed())
    })
  }

  return <section className="news-page" aria-labelledby="news-heading">
    <div className="section-heading"><h1 id="news-heading">What’s new</h1>
      {online && account?.role === 'admin' &&
        <button className="secondary" disabled={pending} onClick={() => {
          setComposing(!composing)
          setHeaderImage(undefined)
          setProblem('')
        }} aria-expanded={composing}>
          {composing ? 'Cancel announcement' : 'New announcement'}
        </button>}
    </div>
    {composing && online && account?.role === 'admin' && <form className="panel news-compose" onSubmit={publish}>
      <label>Category<select name="category">{Object.entries(categories).map(([value, label]) =>
        <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Header image (optional)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) run(async () => { setHeaderImage(await announcementImage(file)) })
      }}/></label>
      {headerImage && <>
        <img className="news-image-preview" src={headerImage} alt="Header image preview"/>
        <label>Image description (optional)<input name="headerAlt" maxLength={160}/></label>
        <button type="button" className="text-button" disabled={pending} onClick={() => setHeaderImage(undefined)}>Remove header image</button>
      </>}
      <label>Title<input required name="title" maxLength={120}/></label>
      <label>Intro paragraph<textarea required name="intro" rows={3} maxLength={600}/></label>
      <label>More text (optional)<textarea name="body" rows={5} maxLength={3000}/></label>
      <button className="primary" disabled={pending}>Publish announcement</button>
    </form>}
    {problem && <p className="notice" role="alert">{problem}</p>}
    {!online && <p>Connect to the server for the latest announcements.</p>}
    {online && !feed && !problem && <p role="status">Loading announcements…</p>}
    {online && feed?.posts.length === 0 && <p>No announcements yet.</p>}
    <div className="news-feed">{feed?.posts.map(post => <article key={post.id} className="panel news-post">
      {post.hasHeaderImage && <img className="news-header-image" src={'/api/news/' + post.id + '/header-image'}
        alt={post.headerAlt} loading="lazy" width={1200} height={675}/>}
      <div className="news-post-content">
        <p className="news-meta"><span>{categories[post.category]}</span>
          <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time></p>
        <h2>{post.title}</h2>
        <p className="news-body">{post.intro}</p>
        {post.body && <details className="news-more">
          <summary><ChevronDown size={16}/><span className="news-expand">Read more</span><span className="news-collapse">Show less</span></summary>
          <p className="news-body">{post.body}</p>
        </details>}
        <div className="button-bar">
          {account ? <button className="secondary" disabled={pending || !online} aria-pressed={post.liked}
            aria-label={post.liked ? 'Unlike announcement' : 'Like announcement'} onClick={() => run(async () => {
              const reaction = await api<Pick<Post, 'liked' | 'likes'>>('/news/' + post.id + '/like',
                json('PUT', { liked: !post.liked }), accountId)
              setFeed(current => current && { ...current, posts: current.posts.map(item => item.id === post.id ? { ...item, ...reaction } : item) })
            })}><Heart size={17} fill={post.liked ? 'currentColor' : 'none'}/> {post.liked ? 'Liked' : 'Like'} <span>{post.likes}</span></button>
            : <span className="news-likes"><Heart size={17}/> {post.likes} {post.likes === 1 ? 'like' : 'likes'}</span>}
          {online && account?.role === 'admin' && <button className="text-button" disabled={pending} onClick={() => {
            if (!confirm('Remove this announcement?')) return
            run(async () => {
              await api('/news/' + post.id, { method: 'DELETE' }, accountId)
              setFeed(await getFeed())
            })
          }}><Trash2 size={15}/> Remove announcement</button>}
        </div>
      </div>
    </article>)}</div>
    {feed?.more && online && <button className="secondary" disabled={pending} onClick={() => run(async () => {
      const older = await getFeed(feed.posts.length)
      setFeed({ more: older.more, posts: [...feed.posts, ...older.posts.filter(post => !feed.posts.some(item => item.id === post.id))] })
    })}>Older announcements</button>}
  </section>
}
