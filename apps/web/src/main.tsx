import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, BookOpen, Check, ChevronRight, CloudDownload, Grid3X3, Heart, LogIn, LogOut,
  Plus, Search, Settings2, Shield, SlidersHorizontal, WifiOff, Wrench } from 'lucide-react'
import type { Difficulty, PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { starterCatalog } from '../../../packages/sudoku/src/catalog.js'
import { defaults, type Preferences, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { api, errorMessage, type Account } from './api.js'
import { offlineRequest, registerOffline } from './offline.js'
import { games } from './registry.js'
import { cacheLevels, db, exportProfile, importProfile, levelKey, listSessions, saveLocal,
  sync, updatePreferences, writeAttempt, type LocalSession } from './storage.js'
import './styles.css'

const Player = lazy(games[0].player)
const Studio = lazy(() => import('./Studio.js'))
const Admin = lazy(() => import('./Admin.js'))
const knownAccount = 'aviarium:profile'
const catalogKey = 'aviarium:catalog'
const startCatalog = () => {
  try { return JSON.parse(localStorage.getItem(catalogKey) ?? 'null') as PublishedLevel[] | null ?? starterCatalog }
  catch { return starterCatalog }
}
const profileAtStart = () => localStorage.getItem(knownAccount) ?? 'guest'

function App() {
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [profile, setProfile] = useState(profileAtStart)
  const [account, setAccount] = useState<Account>()
  const [signIn, setSignIn] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [catalog, setCatalog] = useState(startCatalog)
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [completions, setCompletions] = useState<string[]>([])
  const [prefs, setPrefs] = useState(defaults)
  const [override, setOverride] = useState(() => localStorage.getItem('aviarium:reader') ?? 'account')
  const [active, setActive] = useState<{ session: LocalSession; level: PublishedLevel; head: LocalSession }>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All games')
  const [grade, setGrade] = useState<Difficulty | 'All'>('All')
  const [source, setSource] = useState('All sources')
  const [dialog, showSettings] = useState(false)
  const [notice, setNotice] = useState('')
  const [networkNotice, setNetworkNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [activate, setActivate] = useState<() => void>()
  const saves = useRef<Promise<void>>(Promise.resolve())
  const reader = override === 'account' ? prefs.reader : override === 'on'
  const refreshCatalog = useCallback(async () => {
    try {
      const levels = await api<PublishedLevel[]>('/catalog')
      await cacheLevels(levels)
      localStorage.setItem(catalogKey, JSON.stringify(levels))
      setCatalog(levels)
      return levels
    } catch { return undefined }
  }, [])
  const refreshLocal = useCallback(async () => {
    const [items, settings, completed] = await Promise.all([
      listSessions(profile), db.prefs.get(profile), db.completions.where('profile').equals(profile).toArray(),
    ])
    setSessions(items)
    setPrefs(settings?.data ?? defaults)
    setCompletions(completed.map(item => levelKey(item.level, item.revision)))
  }, [profile])
  const discover = useCallback(async () => {
    try {
      const { user, signIn } = await api<{ user: Account | null; signIn: boolean }>('/me')
      setSignIn(signIn)
      setAccount(user ?? undefined)
      if (user) { localStorage.setItem(knownAccount, user.id); setProfile(user.id) }
    } catch { setAccount(undefined) }
  }, [])
  useEffect(() => {
    const locationChanged = () => { setActive(undefined); setPath(location.pathname.replace(/\/$/, '') || '/') }
    const connection = () => { setOnline(navigator.onLine); if (navigator.onLine) void discover() }
    window.addEventListener('popstate', locationChanged)
    window.addEventListener('online', connection)
    window.addEventListener('offline', connection)
    void discover()
    const check = () => void offlineRequest('player-ready').then(setOffline)
    navigator.serviceWorker?.addEventListener('controllerchange', check)
    void registerOffline(handler => setActivate(() => handler)).then(check).catch(() => undefined)
    return () => {
      window.removeEventListener('popstate', locationChanged)
      window.removeEventListener('online', connection)
      window.removeEventListener('offline', connection)
      navigator.serviceWorker?.removeEventListener('controllerchange', check)
    }
  }, [discover])
  useEffect(() => { void cacheLevels(starterCatalog).then(refreshCatalog).catch(error => setNotice(errorMessage(error))) }, [refreshCatalog, online])
  useEffect(() => { void refreshLocal().catch(error => setNotice(errorMessage(error))) }, [refreshLocal, active])
  useEffect(() => {
    if (!account || account.id !== profile || !online || active) return
    let current = true
    const run = () => {
      if (document.hidden) return
      void saves.current.catch(() => undefined).then(() => sync(profile)).then(() => {
        if (current) { setNetworkNotice(''); void refreshLocal() }
      }, error => { if (current) setNetworkNotice(errorMessage(error)) })
    }
    run()
    const interval = setInterval(run, 20_000)
    document.addEventListener('visibilitychange', run)
    return () => { current = false; clearInterval(interval); document.removeEventListener('visibilitychange', run) }
  }, [account, active, online, profile, refreshLocal])

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
    setActive({ session, level, head: session }); go('/games/sudoku', true)
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
    perform(async () => { setPrefs(await updatePreferences(profile, patch)); if (account && !active && online) await sync(profile) })
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

  return <div className={reader ? 'app reader' : 'app'}>
    <header className="site-header"><div className="frame header-frame">
      <a className="brand" href="/" onClick={event => link(event, '/')}><img src="/icon-192.png" alt=""/><span>Aviarium</span></a>
      <nav aria-label="Main navigation" className="main-nav">
        <a href="/" className={path === '/' ? 'nav-selected' : ''} onClick={event => link(event, '/')}><Grid3X3 size={16}/> Library</a>
        {account && account.role !== 'player' && <a href="/studio" className={path === '/studio' ? 'nav-selected' : ''}
          onClick={event => link(event, '/studio')}><Wrench size={16}/> Studio</a>}
        {account?.role === 'admin' && <a href="/admin" className={path === '/admin' ? 'nav-selected' : ''}
          onClick={event => link(event, '/admin')}><Shield size={16}/> Admin</a>}
      </nav>
      <div className="header-actions">
        {!online && <span className="offline-tag"><WifiOff size={16}/> Offline</span>}
        <button className="icon-button" title="Settings" aria-label="Settings" onClick={() => showSettings(true)}><Settings2 size={19}/></button>
        {account ? <button className="account-button" onClick={() => perform(async () => {
          await api('/auth/logout', { method: 'POST' }); setActive(undefined); setAccount(undefined)
          localStorage.removeItem(knownAccount); setProfile('guest'); go('/')
        })}><LogOut size={16}/><span>{account.name}</span></button>
        : signIn && <a href="/api/auth/login" className="account-button"><LogIn size={16}/> Sign in</a>}
      </div>
    </div></header>
    <main className="frame main-frame">
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      {networkNotice && <p role="status" className="network-notice">Sync delayed. {networkNotice}</p>}
      {activate && !active && <div className="notice">An Aviarium update is ready.<button onClick={activate}>Reload</button></div>}
      <Suspense fallback={<p role="status">Loading…</p>}>
      {path === '/' ? <>
        <section className="hero">
          <div className="hero-content">
            <p className="hero-kicker"><span/> PUZZLE LIBRARY</p>
            <h1>Aviarium</h1>
            <p>A quiet place to play. Find your next puzzle<br className="wide-only"/> or pick up where you left off.</p>
            <button className="primary hero-action" onClick={() => go('/games/sudoku')}>Explore Sudoku <ArrowRight size={17}/></button>
          </div><BoardArt />
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
            <a className="game-card-image" href={game.url} onClick={event => link(event, game.url)} aria-label="Open Sudoku"><BoardArt compact/></a>
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
        leave={() => { setActive(undefined); void refreshLocal() }}
        reset={() => perform(async () => { await archive(active.head); await open(active.level) })}/>
      : path === '/games/sudoku' ? <section className="catalog">
        <button className="text-button back" onClick={() => go('/')}>← Game library</button>
        <div className="section-heading"><div><div className="eyebrow">LOGIC · NUMBERS</div><h1>Sudoku</h1>
          <p>Choose a published puzzle and play at your own pace.</p></div>
          <button className="secondary" disabled={offline || downloading} onClick={() => perform(async () => {
            setDownloading(true)
            try {
              const fresh = await refreshCatalog()
              if (!fresh && !navigator.onLine) throw new Error('Connect to download Sudoku.')
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
      : path === '/studio' && account && account.role !== 'player' ? <Studio key={account.id} account={account} onPublish={() => { void refreshCatalog() }}/>
      : path === '/admin' && account?.role === 'admin' ? <Admin key={account.id} account={account} onCatalogChange={() => { void refreshCatalog() }}/>
      : <section className="panel"><h1>Access required</h1><p>Sign in with an authorized account.</p><button className="secondary" onClick={() => go('/')}>Return to library</button></section>}
      </Suspense>
    </main>
    {dialog && <div className="settings-overlay" onClick={() => showSettings(false)}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><h2><SlidersHorizontal size={20}/> Settings</h2><button className="secondary" onClick={() => showSettings(false)}>Close</button></div>
        <h3>Display</h3>
        <label className="setting-row">E-reader on this device
          <select value={override} onChange={event => { localStorage.setItem('aviarium:reader', event.target.value); setOverride(event.target.value) }}>
            <option value="account">Use default</option><option value="on">On</option><option value="off">Off</option></select></label>
        <label className="setting-row">Default e-reader mode<input type="checkbox" checked={prefs.reader} onChange={event => changePrefs({ reader: event.target.checked })}/></label>
        <h3>Sudoku</h3>
        {([['mistakes', 'Highlight conflicts'], ['timer', 'Show timer'], ['hints', 'Enable hints']] as const).map(([key, label]) =>
          <label className="setting-row" key={key}>{label}<input type="checkbox" checked={prefs[key]} onChange={event => changePrefs({ [key]: event.target.checked })}/></label>)}
        <h3>Progress</h3>
        <p className="muted">{account ? 'Syncs with your account when online.' : 'Playing on this device. Sign in to sync account progress.'}</p>
        <div className="row-actions settings-actions"><button className="secondary" onClick={() => perform(() => exportProfile(profile))}>Export saves</button>
          <label className="secondary file-label"><Plus size={16}/> Import saves<input type="file" accept=".json,application/json" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (file && confirm('Import saved attempts as additional copies?')) perform(async () => {
              const amount = await importProfile(profile, file); await refreshLocal(); setNotice('Imported ' + amount + ' attempts.'); showSettings(false)
            })
          }}/></label>
        </div>
      </section>
    </div>}
    <footer className="frame footer"><span>Aviarium</span><span>Play at your own pace.</span></footer>
  </div>
}

function BoardArt({ compact = false }: {compact?: boolean}) {
  const values = ['', '7', '', '2', '', '9', '', '', '4', '5', '', '', '', '8', '', '3', '', '', '', '6', '', '', '1', '', '', '', '8',
    '6', '', '2', '', '', '', '7', '', '', '', '4', '', '9', '', '3', '', '5', '', '', '', '8', '', '', '', '1', '', '2',
    '1', '', '', '', '4', '', '', '9', '', '', '', '6', '', '3', '', '', '', '5', '3', '', '', '6', '', '2', '', '7', '']
  return <div className={compact ? 'board-art compact-art' : 'board-art hero-art'} aria-hidden="true">
    <div className="art-grid">{values.map((digit, cell) => <span key={cell} className={[
      cell % 9 === 2 || cell % 9 === 5 ? 'art-box-right' : '',
      Math.floor(cell / 9) === 2 || Math.floor(cell / 9) === 5 ? 'art-box-bottom' : '',
      cell === 39 || cell === 41 ? 'art-selected' : '',
      cell >= 36 && cell < 45 ? 'art-active-row' : '',
    ].join(' ')}>{digit}</span>)}</div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
