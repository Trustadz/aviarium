import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CloudDownload, Grid3X3, Heart, LogIn, LogOut,
  Search, Settings2, Shield, Users, WifiOff, Wrench } from 'lucide-react'
import type { Difficulty, PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { defaults, type Preferences, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { api, ApiError, errorMessage, type SessionAccount } from './api.js'
import { offlineRequest, registerOffline } from './offline.js'
import { games } from './registry.js'
import { useSession } from './session.js'
import { cacheLevels, db, levelKey, listSessions, localProfile, saveLocal,
  sync, updatePreferences, writeAttempt, type LocalSession } from './storage.js'
import './styles.css'

const featuredGame = games[0]
const Player = lazy(featuredGame.player)
const Studio = lazy(() => import('./Studio.js'))
const Admin = lazy(() => import('./Admin.js'))

function AppleInstallHelp() {
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia('(display-mode: standalone)').matches
  if (!appleMobile || standalone) return null

  return <details className="install-help">
    <summary>Install Aviarium</summary>
    <p>Open Aviarium in Safari. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
      If offered, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</p>
    <p>If the action is missing, look under <strong>View More</strong> or <strong>Edit Actions</strong> in the Share menu.</p>
  </details>
}

function App() {
  const { account, localPlay, checking, online, signIn, refresh, forget } = useSession()
  const [activate, setActivate] = useState<() => void>()
  useEffect(() => { void registerOffline(handler => setActivate(() => handler)).catch(() => undefined) }, [])
  useEffect(() => {
    if (activate && online && !checking && !account && !localPlay) activate()
  }, [account, activate, checking, localPlay, online])

  if (account || localPlay) return <Library key={account?.id ?? localProfile} account={account} online={online} activate={activate}
    refreshSession={refresh} signOut={forget}/>

  const theme = localStorage.getItem('aviarium:theme') === 'dark' ? 'dark' : 'light'
  return <main className="app login-page" data-theme={theme}>
    <section className="panel login-panel" aria-labelledby="login-title">
      <img src="/aviarium.svg" alt="" width="64" height="64"/>
      <h1 id="login-title">Aviarium</h1>
      {checking ? <p role="status">Checking session…</p> : <>
        <a className="primary" href="/api/auth/login"><LogIn size={18}/> Login with Pocket ID</a>
        {!online ? <p>Connect to the internet to sign in.</p>
          : signIn === false && <p>Pocket ID setup is required on this server.</p>}
      </>}
      <AppleInstallHelp/>
    </section>
  </main>
}

interface LibraryProps {
  account?: SessionAccount
  online: boolean
  activate?: () => void
  refreshSession: () => Promise<void>
  signOut: () => void
}

function Library({ account, online, activate, refreshSession, signOut }: LibraryProps) {
  const accountId = account?.id
  const profile = accountId ?? localProfile
  const catalogKey = 'aviarium:catalog:' + profile
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [catalog, setCatalog] = useState<PublishedLevel[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(catalogKey) ?? 'null')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [completions, setCompletions] = useState<string[]>([])
  const [prefs, setPrefs] = useState(defaults)
  const [reader, setReader] = useState(() => localStorage.getItem('aviarium:reader') === 'on')
  const [theme, setTheme] = useState(() => localStorage.getItem('aviarium:theme') === 'dark' ? 'dark' : 'light')
  const [active, setActive] = useState<{ session: LocalSession; level: PublishedLevel; head: LocalSession }>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All games')
  const [grade, setGrade] = useState<Difficulty | 'All'>('All')
  const [source, setSource] = useState('All sources')
  const [dialog, showDialog] = useState<'display' | 'sudoku' | 'account'>()
  const [notice, setNotice] = useState('')
  const [networkNotice, setNetworkNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const saves = useRef<Promise<void>>(Promise.resolve())
  const refreshCatalog = useCallback(async () => {
    try {
      const levels = await api<PublishedLevel[]>('/catalog', undefined, accountId)
      await cacheLevels(levels)
      localStorage.setItem(catalogKey, JSON.stringify(levels))
      setCatalog(levels)
      return levels
    } catch (error) {
      if (error instanceof ApiError && [401, 409].includes(error.status)) void refreshSession()
      return undefined
    }
  }, [accountId, catalogKey, refreshSession])
  const refreshLocal = useCallback(async () => {
    const [items, settings, completed] = await Promise.all([
      listSessions(profile), db.prefs.get(profile), db.completions.where('profile').equals(profile).toArray(),
    ])
    setSessions(items)
    setPrefs(settings?.data ?? defaults)
    setCompletions(completed.map(item => levelKey(item.level, item.revision)))
  }, [profile])
  useEffect(() => {
    const locationChanged = () => { setActive(undefined); setPath(location.pathname.replace(/\/$/, '') || '/') }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') showDialog(undefined) }
    const check = () => void offlineRequest('player-ready').then(setOffline)
    window.addEventListener('popstate', locationChanged)
    window.addEventListener('keydown', closeOnEscape)
    navigator.serviceWorker?.addEventListener('controllerchange', check)
    check()
    return () => {
      window.removeEventListener('popstate', locationChanged)
      window.removeEventListener('keydown', closeOnEscape)
      navigator.serviceWorker?.removeEventListener('controllerchange', check)
    }
  }, [])
  useEffect(() => { if (online) void refreshCatalog() }, [refreshCatalog, online])
  useEffect(() => { void refreshLocal().catch(error => setNotice(errorMessage(error))) }, [refreshLocal, active])
  useEffect(() => {
    if (!accountId || !online || active) return
    let current = true
    const run = () => {
      if (document.hidden) return
      void saves.current.catch(() => undefined).then(() => sync(profile)).then(() => {
        if (current) { setNetworkNotice(''); void refreshLocal() }
      }, error => {
        if (!current) return
        if (error instanceof ApiError && [401, 409].includes(error.status)) void refreshSession()
        else setNetworkNotice(errorMessage(error))
      })
    }
    run()
    const interval = setInterval(run, 20_000)
    document.addEventListener('visibilitychange', run)
    return () => { current = false; clearInterval(interval); document.removeEventListener('visibilitychange', run) }
  }, [accountId, active, online, profile, refreshLocal, refreshSession])

  function go(next: string, keepActive = false) {
    if (!keepActive) setActive(undefined)
    if (location.pathname !== next) history.pushState(null, '', next)
    setPath(next)
    window.scrollTo(0, 0)
  }
  function link(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); go(next)
  }
  function record(attempt: NonNullable<typeof active>, data: SudokuSave) {
    const result = saves.current.catch(() => undefined).then(async () => {
      attempt.head = await writeAttempt(attempt.head, data)
      if (attempt.head.id !== attempt.session.id) setNotice('This attempt changed in another tab or device. Your moves are saved in a separate copy.')
    })
    saves.current = result
    return result
  }
  async function open(level: PublishedLevel, existing?: LocalSession) {
    const { createSave } = await games[0].player()
    const session = existing ?? { id: crypto.randomUUID(), revision: 0, data: createSave(level),
      archived: false, profile, updated: Date.now(), dirty: true }
    await cacheLevels([level])
    if (!existing) await saveLocal(session)
    setNotice(''); setActive({ session, level, head: session }); go('/games/sudoku', true)
  }
  async function resume(session: LocalSession) {
    const stored = await db.levels.get(levelKey(session.data.level, session.data.levelRevision))
    if (!stored) throw new Error('This level revision is not downloaded yet.')
    await open(stored.level, session)
  }
  async function archive(session: LocalSession) {
    await saves.current.catch(() => undefined)
    const stored = await db.sessions.get(session.id)
    if (stored?.profile === profile) await saveLocal({ ...stored, archived: true, updated: Date.now() })
    await refreshLocal()
  }
  function perform(task: () => Promise<unknown>) { void task().catch(error => setNotice(errorMessage(error))) }
  function changePrefs(patch: Partial<Preferences>) {
    setPrefs(current => ({ ...current, ...patch }))
    perform(async () => {
      try { await updatePreferences(profile, patch) }
      catch (error) { await refreshLocal().catch(() => undefined); throw error }
      if (account && !active && online) await sync(profile)
    })
  }
  const matches = useMemo(() => games.filter(game => (!reader || game.eReader) &&
    (category !== 'Favorites' || prefs.favorite) &&
    (category !== 'Logic' || game.tags.includes('Logic')) &&
    (game.title + ' ' + game.tags.join(' ')).toLowerCase().includes(query.trim().toLowerCase())),
  [reader, prefs.favorite, category, query])
  const current = sessions.filter(session => !session.archived && !session.data.completed)
  const completed = new Set([...completions, ...sessions.filter(item => item.data.completed)
    .map(item => levelKey(item.data.level, item.data.levelRevision))])
  const [reviewSession, ...otherSessions] = current
  const difficultyCounts = catalog.filter(level => grade === 'All' || level.difficulty === grade)
    .filter(level => source === 'All sources' || level.source === source)
  const recent = sessions.find(session => !session.archived)
  const levelTitle = (session: LocalSession) => catalog.find(level => level.id === session.data.level)?.title ?? 'Published puzzle'

  const canEditSudoku = online && account && (account.role === 'admin' || account.editorGames.includes(featuredGame.id))
  const preview = catalog.find(level => level.id === 'first-light') ?? catalog[0]
  const inLibrary = path === '/'
  const inGame = games.some(game => game.url === path)
  const surface = path === '/games/sudoku' || path === '/studio' ? 'sudoku' : 'library'

  return <div className={reader ? 'app reader' : 'app'} data-theme={theme} data-surface={surface}>
    {inLibrary && <header className="site-header"><div className="frame header-frame">
      <a className="brand" href="/" onClick={event => link(event, '/')}><img src="/aviarium.svg" alt=""/><span>Aviarium</span></a>
      <nav aria-label="Main navigation" className="main-nav">
        <a href="/" className="nav-selected" aria-current="page" onClick={event => link(event, '/')}><Grid3X3 size={16}/> Library</a>
        {canEditSudoku && <a href="/studio" onClick={event => link(event, '/studio')}><Wrench size={16}/> Studio</a>}
        {online && account?.role === 'admin' && <a href="/admin" onClick={event => link(event, '/admin')}><Shield size={16}/> Admin</a>}
      </nav>
      <div className="header-actions">
        {!online && <span className="offline-tag"><WifiOff size={16}/> Offline</span>}
        <button className="icon-button" title="Display settings" aria-label="Display settings" onClick={() => showDialog('display')}><Settings2 size={19}/></button>
        {account ? <button className="account-button" onClick={() => showDialog('account')}><Users size={16}/><span>{account.name}</span></button>
          : <span className="offline-tag" title="Progress stays on this device">Local play</span>}
      </div>
    </div></header>}
    <main className={(inGame ? 'game-frame' : 'frame main-frame') + (surface === 'sudoku' ? ' sudoku-theme' : '')}>
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      {inLibrary && networkNotice && <p role="status" className="network-notice">Sync delayed. {networkNotice}</p>}
      {inLibrary && activate && <div className="notice">An Aviarium update is ready.<button onClick={activate}>Reload</button></div>}
      <Suspense fallback={<p role="status">Loading…</p>}>
      {path === '/' ? <>
        <section className="hero">
          <div className="hero-content">
            <p className="hero-kicker"><span/> PUZZLE LIBRARY</p>
            <h1>Aviarium</h1>
            <p>A quiet place to play. Find your next puzzle<br className="wide-only"/> or pick up where you left off.</p>
            <button className="primary hero-action" onClick={() => go('/games/sudoku')}>Explore Sudoku <ArrowRight size={17}/></button>
          </div>
          {preview && <div className={'hero-art ' + featuredGame.theme} aria-hidden="true"><featuredGame.Preview grid={preview.grid}/></div>}
        </section>
        {reviewSession && <section className="continue-card">
          <div className="mini-board"><Grid3X3 size={24}/></div>
          <div><div className="eyebrow">CONTINUE PLAYING</div><strong>{levelTitle(reviewSession)}</strong></div>
          <button className="secondary" onClick={() => perform(() => resume(reviewSession))}>Resume <ChevronRight size={17}/></button>
        </section>}
        {!reviewSession && recent && <section className="continue-card">
          <div className="mini-board"><Grid3X3 size={24}/></div>
          <div><div className="eyebrow">RECENTLY PLAYED</div><strong>{levelTitle(recent)}</strong></div>
          <button className="secondary" onClick={() => go('/games/sudoku')}>Browse puzzles <ChevronRight size={17}/></button>
        </section>}
        <section className="library">
          <div className="section-heading"><div><h2>Game library</h2><p>Browse by category or open your favorites.</p></div>
            <label className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games" aria-label="Search games"/></label>
          </div>
          <div className="tabs" aria-label="Game categories">{['All games', 'Logic', 'Favorites'].map(name =>
            <button key={name} aria-pressed={name === category} onClick={() => setCategory(name)}>{name}</button>)}</div>
          <div className="game-list">{matches.map(game => <article className="game-card" key={game.id}>
            <a className={'game-card-image ' + game.theme} href={game.url} onClick={event => link(event, game.url)} aria-label={'Open ' + game.title}>{preview && <game.Preview grid={preview.grid}/>}</a>
            <div className="game-card-body">
              <div className="card-title"><h3><a href={game.url} onClick={event => link(event, game.url)}>{game.title}</a></h3>
              <button className="icon-button" aria-label={prefs.favorite ? 'Remove Sudoku from favorites' : 'Add Sudoku to favorites'}
                aria-pressed={prefs.favorite} onClick={() => changePrefs({ favorite: !prefs.favorite })}><Heart size={19} fill={prefs.favorite ? 'currentColor' : 'none'}/></button></div>
              <p>{game.description}</p>
              <div className="card-footer"><span className="badge">Logic</span><span className="badge e-ink"><BookOpen size={13}/> E-reader</span>
                <a className="text-button" href={game.url} onClick={event => link(event, game.url)}>Play <ArrowRight size={16}/></a></div>
            </div>
          </article>)}</div>
          {!matches.length && <p className="empty">No games match this view.</p>}
        </section></>
      : path === '/games/sudoku' && active ? <Player key={active.session.id} session={active.session} level={active.level} preferences={prefs}
        reader={reader} persist={data => record(active, data)}
        leave={() => { go('/games/sudoku'); void refreshLocal() }}
        reset={() => perform(async () => { await archive(active.head); await open(active.level) })}/>
      : path === '/games/sudoku' ? <section className="catalog" aria-labelledby="game-menu-title">
        <div className="game-menu-heading">
          <h1 id="game-menu-title">Sudoku</h1>
          <button className="secondary" onClick={() => go('/')}><LogOut size={17}/> Exit to library</button>
        </div>
        <div className="button-bar">
          <button className="secondary" onClick={() => showDialog('sudoku')}><Settings2 size={17}/> Sudoku settings</button>
          <button className="secondary" disabled={offline || downloading} onClick={() => perform(async () => {
            setDownloading(true)
            try {
              const fresh = await refreshCatalog()
              if (!fresh && !online) throw new Error('Connect to download Sudoku.')
              if (!await offlineRequest('download-player')) throw new Error('Offline download needs the installed production site. Reload and try again.')
              setOffline(true); setNotice('Sudoku and the downloaded puzzle catalog are ready for offline play.')
            } finally { setDownloading(false) }
          })}>{offline ? <Check size={18}/> : <CloudDownload size={18}/>} {offline ? 'Available offline' : downloading ? 'Downloading…' : 'Download for offline'}</button>
        </div>
        {current.length > 0 && <div className="panel attempts"><h2>Saved attempts</h2>{[reviewSession, ...otherSessions].filter(Boolean).map(item =>
          <div className="level-row" key={item.id}><div><strong>{levelTitle(item)}</strong><p>{item.parentId ? 'Conflict copy · ' : ''}{new Date(item.updated).toLocaleString()}</p></div>
          <div className="row-actions"><button className="text-button" onClick={() => perform(() => archive(item))}>Archive</button>
          <button className="secondary" onClick={() => perform(() => resume(item))}>Resume</button></div></div>)}</div>}
        <div className="catalog-filters"><div className="tabs" aria-label="Difficulty">{(['All', 'Easy', 'Medium', 'Hard'] as const).map(value =>
          <button key={value} aria-pressed={value === grade} onClick={() => setGrade(value)}>{value}</button>)}</div>
          <select aria-label="Puzzle source" value={source} onChange={event => setSource(event.target.value)}>
          {['All sources', 'Built-in', 'Generated', 'Creator'].map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="panel">{difficultyCounts.map(level => <div key={levelKey(level.id, level.revision)} className="level-row">
          <div className="level-name"><span className="mini-board"><Grid3X3 size={19}/></span><div><strong>{level.title}</strong><p>{level.source} · Revision {level.revision}</p></div></div>
          <div className="row-actions"><span className={'badge ' + level.difficulty.toLowerCase()}>{level.difficulty}</span>
          {completed.has(levelKey(level.id, level.revision)) && <span className="badge easy"><Check size={14}/> Solved</span>}
          <button className="icon-button" aria-label={'Play ' + level.title} onClick={() => perform(() => open(level))}><ChevronRight size={22}/></button></div>
        </div>)}{!difficultyCounts.length && <p className="empty">No published puzzles match these filters.</p>}</div>
      </section>
      : path === '/studio' && canEditSudoku ? <>
        <button className="text-button back" onClick={() => go('/')}><ArrowLeft size={17}/> Back to library</button>
        <Studio key={account.id} account={account} onPublish={() => { void refreshCatalog() }}/>
      </>
      : path === '/admin' && online && account?.role === 'admin' ? <>
        <button className="text-button back" onClick={() => go('/')}><ArrowLeft size={17}/> Back to library</button>
        <Admin key={account.id} account={account} onCatalogChange={() => { void refreshCatalog() }}/>
      </>
      : <section className="panel"><h1>Access required</h1><p>Sign in with an authorized account.</p><button className="secondary" onClick={() => go('/')}>Return to library</button></section>}
      </Suspense>
    </main>
    {dialog && <div className="settings-overlay" onClick={() => showDialog(undefined)}>
      <section className={'settings-panel' + (dialog === 'sudoku' ? ' sudoku-theme' : '')}
        role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><h2 id="settings-title">
          {dialog === 'display' ? 'Display settings' : dialog === 'sudoku' ? 'Sudoku settings' : 'Account'}
        </h2><button autoFocus className="secondary" onClick={() => showDialog(undefined)}>Close</button></div>
        {dialog === 'display' && <>
          <label className="setting-row">Theme<select value={theme} onChange={event => {
            const value = event.target.value === 'dark' ? 'dark' : 'light'
            localStorage.setItem('aviarium:theme', value); setTheme(value)
          }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label className="setting-row">E-reader mode<input type="checkbox" checked={reader} onChange={event => {
            localStorage.setItem('aviarium:reader', event.target.checked ? 'on' : 'off'); setReader(event.target.checked)
          }}/></label>
          <p className="muted">These settings apply to this device.</p>
        </>}
        {dialog === 'sudoku' && ([['mistakes', 'Highlight conflicts'], ['timer', 'Show timer'], ['hints', 'Enable hints']] as const)
          .map(([key, label]) => <label className="setting-row" key={key}>{label}<input type="checkbox" checked={prefs[key]}
            onChange={event => changePrefs({ [key]: event.target.checked })}/></label>)}
        {dialog === 'account' && account && <>
          <h3>{account.name}</h3>
          <p className="muted">Your progress syncs when you’re online.</p>
          {online ? <div className="button-bar settings-actions">
            <a className="primary" href="/api/auth/login?switch=1" onClick={event => {
              event.preventDefault()
              perform(async () => {
                await saves.current
                await sync(profile).catch(() => undefined)
                location.assign('/api/auth/login?switch=1')
              })
            }}><Users size={17}/> Switch account</a>
            <button className="secondary" onClick={() => perform(async () => {
              await saves.current
              await sync(profile).catch(() => undefined)
              await api('/auth/logout', { method: 'POST' }, account.id)
              go('/')
              signOut()
            })}><LogOut size={16}/> Sign out</button>
          </div> : <p>Reconnect to switch accounts or sign out.</p>}
          <AppleInstallHelp/>
        </>}
      </section>
    </div>}
    {inLibrary && <footer className="frame footer"><span>Aviarium</span><span>Play at your own pace.</span></footer>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
