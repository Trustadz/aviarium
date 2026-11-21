import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, BookOpen, Check, Heart, History, LogIn, LogOut, Newspaper,
  Pencil, Search, Settings2, Trash2, Users, WifiOff } from 'lucide-react'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { defaults, type Preferences, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { packLevelId, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { api, ApiError, errorMessage, json, type SessionAccount, type TestRole } from './api.js'
import { AccountMenu, ProfileForm } from './AccountSettings.js'
import { News } from './News.js'
import { ContinueGames } from './ContinueGames.js'
import { registerOffline, useGameDownloads } from './offline.js'
import { games } from './registry.js'
import { useSession } from './session.js'
import { PackCards, PackRoadmap, QuickPlay, SudokuHistory, packPath } from './SudokuMenu.js'
import { cacheLevels, db, deleteSavedGame, isResumable, levelKey, listSessions, localProfile, saveLocal,
  sync, updatePreferences, writeAttempt, type LocalSession } from './storage.js'
import './styles.css'

const featuredGame = games[0]
const Player = lazy(featuredGame.player)
const Studio = lazy(() => import('./Studio.js'))
const PackStudio = lazy(() => import('./PackStudio.js'))
const Admin = lazy(() => import('./Admin.js'))

type ColorScheme = 'light' | 'dark'
type ThemePreference = 'auto' | ColorScheme

const themeKey = 'aviarium:theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

function themePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

function readSystemTheme(): ColorScheme {
  return systemTheme.matches ? 'dark' : 'light'
}

function subscribeToSystemTheme(change: () => void) {
  systemTheme.addEventListener('change', change)
  return () => systemTheme.removeEventListener('change', change)
}

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
  const [preference, setPreference] = useState(() => themePreference(localStorage.getItem(themeKey)))
  const system = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme)
  const theme = preference === 'auto' ? system : preference
  useGameDownloads(undefined, online, !checking && !account && !localPlay)
  const [activate, setActivate] = useState<() => void>()
  useEffect(() => { void registerOffline(handler => setActivate(() => handler)).catch(() => undefined) }, [])
  useEffect(() => {
    if (activate && online && !checking && !account && !localPlay) activate()
  }, [account, activate, checking, localPlay, online])

  if (account || localPlay) return <Library key={account?.id ?? localProfile} account={account} online={online} activate={activate}
    refreshSession={refresh} signOut={forget} theme={theme} preference={preference} onThemeChange={value => {
      localStorage.setItem(themeKey, value)
      setPreference(value)
    }}/>

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
  theme: ColorScheme
  preference: ThemePreference
  onThemeChange: (value: ThemePreference) => void
}

function Library({ account, online, activate, refreshSession, signOut, theme, preference, onThemeChange }: LibraryProps) {
  const accountId = account?.id
  const profile = accountId ?? localProfile
  const catalogKey = 'aviarium:catalog:' + profile
  const packIndexKey = 'aviarium:pack-index:' + profile
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [catalog, setCatalog] = useState<PublishedLevel[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(catalogKey) ?? 'null')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [savedLevels, setSavedLevels] = useState<ReadonlyMap<string, PublishedLevel>>(new Map())
  const [packs, setPacks] = useState<PublishedPack[]>([])
  const [viewedPack, setViewedPack] = useState<PublishedPack>()
  const [packProblem, setPackProblem] = useState('')
  const [completions, setCompletions] = useState<string[]>([])
  const [prefs, setPrefs] = useState(defaults)
  const [reader, setReader] = useState(() => localStorage.getItem('aviarium:reader') === 'on')
  const [manageInstalls, setManageInstalls] = useState(() => localStorage.getItem('aviarium:manage-installs') === 'on')
  const [active, setActive] = useState<{ session: LocalSession; level: PublishedLevel; head: LocalSession; pack?: PublishedPack }>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All games')
  const [dialog, showDialog] = useState<'display' | 'sudoku' | 'account'>()
  const [changingRole, setChangingRole] = useState(false)
  const [notice, setNotice] = useState('')
  const [networkNotice, setNetworkNotice] = useState('')
  const openGame = games.find(game => path === game.url || path.startsWith(game.url + '/'))
  const { installed, remove, recordActivity } = useGameDownloads(openGame?.id, online)
  const canPlay = online || installed.includes(featuredGame.id)
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
  const refreshPacks = useCallback(async () => {
    const published = await api<PublishedPack[]>('/packs', undefined, accountId)
    const records = published.map(pack => ({ key: levelKey(pack.id, pack.revision), pack }))
    await db.packs.bulkPut(records)
    localStorage.setItem(packIndexKey, JSON.stringify(records.map(record => record.key)))
    setPacks(published)
  }, [accountId, packIndexKey])
  const findPack = useCallback(async (id: string, revision: number, review = false) => {
    const key = levelKey(id, revision)
    const cached = await db.packs.get(key)
    if (cached && (!review || !online)) return cached.pack
    if (!online) throw new Error('Connect to open this pack for the first time.')
    try {
      const { ownedByViewer, ...pack } = await api<PublishedPack>(`/packs/${id}/${revision}`, undefined, accountId)
      await db.packs.put({ key, pack })
      return { ...pack, ownedByViewer }
    } catch (error) {
      if (cached) return cached.pack
      throw error
    }
  }, [accountId, online])
  const refreshLocal = useCallback(async () => {
    const [items, settings, completed] = await Promise.all([
      listSessions(profile), db.prefs.get(profile), db.completions.where('profile').equals(profile).toArray(),
    ])
    const levelKeys = [...new Set(items.filter(item => isResumable(item) || item.data.completed)
      .map(item => levelKey(item.data.level, item.data.levelRevision)))]
    const levels = await db.levels.bulkGet(levelKeys)
    setSavedLevels(new Map(levels.flatMap(item => item ? [[item.key, item.level]] : [])))
    setSessions(items)
    setPrefs({ ...defaults, ...settings?.data })
    setCompletions(completed.map(item => levelKey(item.level, item.revision)))
  }, [profile])
  useEffect(() => {
    const locationChanged = () => { setActive(undefined); setPath(location.pathname.replace(/\/$/, '') || '/') }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') showDialog(undefined) }
    window.addEventListener('popstate', locationChanged)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('popstate', locationChanged)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  useEffect(() => { if (online) void refreshCatalog() }, [refreshCatalog, online])
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (online) {
        try { await refreshPacks(); return } catch { /* Use the last available catalog. */ }
      }
      const index: unknown = JSON.parse(localStorage.getItem(packIndexKey) ?? '[]')
      if (!Array.isArray(index) || !index.every(key => typeof key === 'string')) return
      const cached = await db.packs.bulkGet(index)
      if (!cancelled) setPacks(cached.flatMap(record => record ? [record.pack] : []))
    }
    void load().catch(() => undefined)
    return () => { cancelled = true }
  }, [online, packIndexKey, refreshPacks])
  useEffect(() => {
    const match = /^\/games\/sudoku\/packs\/([a-z0-9-]+)\/(\d+)$/.exec(path)
    if (!match) return
    let cancelled = false
    setViewedPack(undefined); setPackProblem('')
    void findPack(match[1], Number(match[2]), true).then(pack => {
      if (!cancelled) setViewedPack(pack)
    }, error => { if (!cancelled) setPackProblem(errorMessage(error)) })
    return () => { cancelled = true }
  }, [path, findPack])
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
    recordActivity(featuredGame.id)
    const result = saves.current.catch(() => undefined).then(async () => {
      attempt.head = await writeAttempt(attempt.head, data)
      if (attempt.head.id !== attempt.session.id) setNotice('This attempt changed in another tab or device. Your moves are saved in a separate copy.')
    })
    saves.current = result
    return result
  }
  async function open(level: PublishedLevel, existing?: LocalSession, suppliedPack?: PublishedPack) {
    if (!canPlay) throw new Error('Connect to install Sudoku on this device.')
    const pack = suppliedPack ?? (level.pack && await findPack(level.pack.id, level.pack.revision))
    if (pack?.data.rules.inOrder && level.pack && level.pack.stop > 1 &&
        !completed.has(levelKey(packLevelId(pack.id, level.pack.stop - 1), pack.revision)))
      throw new Error('Solve the previous stop in this pack first.')
    const { createSave } = await featuredGame.player()
    const session = existing ?? { id: crypto.randomUUID(), revision: 0, data: createSave(level, pack),
      archived: false, profile, updated: Date.now(), dirty: true }
    await cacheLevels([level])
    if (!existing) await saveLocal(session)
    setNotice(''); setActive({ session, level, head: session, pack }); go('/games/sudoku', true)
  }
  async function resume(id: string) {
    const session = await db.sessions.get(id)
    if (!session || session.profile !== profile || !isResumable(session)) throw new Error('This saved game is unavailable.')
    const stored = await db.levels.get(levelKey(session.data.level, session.data.levelRevision))
    if (!stored) throw new Error('This level revision is not downloaded yet.')
    await open(stored.level, session)
  }
  async function deleteAttempt(id: string) {
    await saves.current.catch(() => undefined)
    await deleteSavedGame(profile, id)
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
  function changeTestRole(role: TestRole) {
    if (!account?.testRole || !online || changingRole) return
    setChangingRole(true)
    perform(async () => {
      try {
        await api('/auth/test-role', json('POST', { role }), account.id)
        await refreshSession()
      } catch (error) {
        showDialog(undefined)
        throw error
      } finally {
        setChangingRole(false)
      }
    })
  }
  const matches = useMemo(() => games.filter(game => (!reader || game.eReader) &&
    (category !== 'Favorites' || prefs.favorite) &&
    (category !== 'Logic' || game.tags.includes('Logic')) &&
    (game.title + ' ' + game.tags.join(' ')).toLowerCase().includes(query.trim().toLowerCase())),
  [reader, prefs.favorite, category, query])
  const continueCards = sessions.flatMap(session => {
    if (!isResumable(session)) return []
    const game = games.find(game => game.id === session.data.game)
    if (!game || (reader && !game.eReader)) return []
    const level = savedLevels.get(levelKey(session.data.level, session.data.levelRevision))
    const { entries } = session.data.board
    return [{
      id: session.id,
      game: game.id,
      title: level?.title ?? game.title,
      details: [game.title, level?.difficulty, session.parentId && 'Conflict copy'].filter(Boolean).join(' · '),
      progress: `${entries.filter(Boolean).length} of ${entries.length} cells filled`,
      preview: <game.Preview grid={level?.grid} entries={entries}/>,
      canResume: Boolean(level) && (online || installed.includes(game.id)),
    }]
  })
  function continueRow(gameId?: string) {
    return <ContinueGames games={gameId ? continueCards.filter(card => card.game === gameId) : continueCards}
      resume={id => perform(() => resume(id))} remove={id => {
        const card = continueCards.find(card => card.id === id)
        if (!card || !confirm(`Delete the saved game for “${card.title}”?`)) return
        perform(async () => {
          await deleteAttempt(id)
          await refreshLocal()
          if (accountId && online) {
            await sync(profile)
            await refreshLocal()
          }
        })
      }}/>
  }
  const completed = new Set([...completions, ...sessions.filter(item => item.data.completed)
    .map(item => levelKey(item.data.level, item.data.levelRevision))])

  const editableGames = account && online ? games.filter(game =>
    account.role === 'admin' || account.editorGames.includes(game.id)) : []
  const canEditSudoku = Boolean(account && editableGames.some(game => game.id === featuredGame.id))
  const preview = catalog.find(level => level.id === 'first-light') ?? catalog[0]
  const inLibrary = path === '/'
  const inNews = path === '/news'
  const inStudio = path === '/studio' || path === '/studio/sudoku' || path === '/studio/packs'
  const inAdmin = path === '/admin'
  const inGame = Boolean(openGame)
  const inShell = !inGame
  const surface = inGame ? 'sudoku' : inStudio ? 'studio' : 'library'
  const sharedPuzzle = new URLSearchParams(location.search)
  const sharedId = sharedPuzzle.get('puzzle')
  const sharedRevision = sharedPuzzle.get('revision')

  return <div className={'app' + (reader ? ' reader' : '') + (inShell ? ' app-shell' : '')} data-theme={theme} data-surface={surface}>
    {inShell && <>
      <header className="site-header"><div className="frame header-frame">
        <a className="brand" href="/" aria-label="Aviarium home" onClick={event => link(event, '/')}><img src="/aviarium.svg" alt=""/>
          <span>{inStudio ? 'Studio' : inNews ? 'News' : inAdmin ? 'Administration' : 'Aviarium'}</span>
        </a>
        {!online && <span className="offline-tag"><WifiOff size={16}/> Offline</span>}
      </div></header>
      <div className="app-rail">
        <nav aria-label="Main navigation" className="app-destinations">
          <a href="/" aria-current={inLibrary ? 'page' : undefined} onClick={event => link(event, '/')}><BookOpen size={21}/><span>Library</span></a>
          {editableGames.length > 0 && <a href="/studio" aria-current={inStudio ? 'page' : undefined}
            onClick={event => link(event, '/studio')}><Pencil size={21}/><span>Studio</span></a>}
          <a href="/news" aria-current={inNews ? 'page' : undefined} onClick={event => link(event, '/news')}><Newspaper size={21}/><span>News</span></a>
        </nav>
        <AccountMenu account={account} open={showDialog}
          administration={online && account?.role === 'admin' ? () => go('/admin') : undefined}/>
      </div>
    </>}
    <main className={(inGame ? 'game-frame' : 'frame main-frame') + (inGame ? ' sudoku-theme' : '')}>
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      {inLibrary && networkNotice && <p role="status" className="network-notice">Sync delayed. {networkNotice}</p>}
      {inLibrary && online && activate && <div className="notice">An Aviarium update is ready.<button onClick={activate}>Reload</button></div>}
      <Suspense fallback={<p role="status">Loading…</p>}>
      {inLibrary ? <>
        {continueRow()}
        <section className="hero">
          <div className="hero-content">
            <p className="hero-kicker"><span/> PUZZLE LIBRARY</p>
            <h1>Aviarium</h1>
            <p>A quiet place to play. Find your next puzzle<br className="wide-only"/> or pick up where you left off.</p>
            <div className="hero-actions">
              <button className="primary hero-action" onClick={() => go('/games/sudoku')}>Explore Sudoku <ArrowRight size={17}/></button>
            </div>
          </div>
          {preview && <div className={'hero-art ' + featuredGame.theme} aria-hidden="true"><featuredGame.Preview grid={preview.grid}/></div>}
        </section>
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
              {manageInstalls && installed.includes(game.id) && <div className="game-download">
                <span><Check size={15}/> Installed on this device</span>
                <button className="secondary" aria-label={'Remove ' + game.title + ' download'}
                  onClick={() => perform(() => remove(game.id))}><Trash2 size={15}/> Remove download</button>
              </div>}
            </div>
          </article>)}</div>
          {!matches.length && <p className="empty">No games match this view.</p>}
        </section></>
      : path === '/games/sudoku' && active ? <Player key={active.session.id} session={active.session} level={active.level} pack={active.pack} preferences={prefs}
        reader={reader} persist={data => record(active, data)} openSettings={() => showDialog('sudoku')}
        leave={() => perform(async () => {
          await saves.current.catch(() => undefined)
          try { await refreshLocal() }
          finally { go(active.pack ? packPath(active.pack) : '/games/sudoku') }
        })}
        reset={() => perform(async () => { await deleteAttempt(active.head.id); await open(active.level, undefined, active.pack) })}/>
      : path === '/games/sudoku/history' ? <SudokuHistory sessions={sessions} levels={savedLevels} packs={packs}
        leave={() => go('/games/sudoku')} replay={level => perform(() => open(level))} canPlay={canPlay}/>
      : path.startsWith('/games/sudoku/packs/') ? viewedPack && packPath(viewedPack) === path
        ? <PackRoadmap pack={viewedPack} completed={completed} sessions={sessions} canPlay={canPlay}
          canExport={Boolean(canEditSudoku && (account?.role === 'admin' || viewedPack.ownedByViewer))}
          leave={() => go('/games/sudoku')} play={level => perform(() => {
            const existing = sessions.find(item => isResumable(item) && item.data.level === level.id && item.data.levelRevision === level.revision)
            return existing ? resume(existing.id) : open(level, undefined, viewedPack)
          })}/>
        : <section className="catalog"><button className="text-button" onClick={() => go('/games/sudoku')}>Sudoku menu</button>
          <p role={packProblem ? 'alert' : 'status'}>{packProblem || 'Loading pack…'}</p></section>
      : path === '/games/sudoku' ? <section className="catalog sudoku-menu" aria-labelledby="game-menu-title">
        <div className="game-menu-heading">
          <div className="game-navigation">
            <button className="text-button back" aria-label="Exit to library" onClick={() => go('/')}><ArrowLeft size={17}/> Library</button>
            <div className="sudoku-nav-tools">
              <button className="text-button" onClick={() => go('/games/sudoku/history')}><History size={17}/> History</button>
              <button className="icon-button" aria-label="Sudoku settings" title="Sudoku settings" onClick={() => showDialog('sudoku')}><Settings2 size={18}/></button>
            </div>
          </div>
          <h1 id="game-menu-title">Sudoku</h1>
        </div>
        {continueRow(featuredGame.id)}
        {!canPlay && <p className="notice">Connect to install Sudoku on this device.</p>}
        {sharedId && sharedRevision && <button className="secondary" disabled={!online} onClick={() => perform(async () => {
          const level = await api<PublishedLevel>(`/sudoku/level/${encodeURIComponent(sharedId)}/${encodeURIComponent(sharedRevision)}`, undefined, accountId)
          await open(level)
        })}>Play shared puzzle</button>}
        <QuickPlay online={online} profile={profile} generate={async (difficulty, seed, version) => {
          const level = await api<PublishedLevel>('/sudoku/quick-play', json('POST', { difficulty, seed, version }), accountId)
          await open(level)
        }}/>
        <PackCards packs={packs} completed={completed} open={pack => go(packPath(pack))}/>
      </section>
      : inNews ? <News account={account} online={online}/>
      : inStudio && account && editableGames.length > 0 ? path === '/studio' ? <section className="creator-home" aria-labelledby="studio-heading">
        <h1 id="studio-heading">Studio</h1>
        <div className="game-list">{editableGames.map(game => <article className="game-card" key={game.id}>
          <a className={'game-card-image ' + game.theme} aria-label={'Create for ' + game.title}
            href={'/studio/' + game.id} onClick={event => link(event, '/studio/' + game.id)}>
            {preview && <game.Preview grid={preview.grid}/>}
          </a>
          <div className="game-card-body">
            <h2>{game.title}</h2>
            <a className="primary" href={'/studio/' + game.id} onClick={event => link(event, '/studio/' + game.id)}>
              Open workspace <ArrowRight size={16}/>
            </a>
          </div>
        </article>)}</div>
      </section> : canEditSudoku ? <>
        <div className="studio-tools">
          <label>Studio game<select value={featuredGame.id} onChange={event => go(event.target.value ? '/studio/' + event.target.value : '/studio')}>
            <option value="">All games</option>
            {editableGames.map(game => <option value={game.id} key={game.id}>{game.title}</option>)}
          </select></label>
          <div className="tabs" aria-label="Studio sections">
            <button aria-pressed={path === '/studio/sudoku'} onClick={() => go('/studio/sudoku')}>Puzzles</button>
            <button aria-pressed={path === '/studio/packs'} onClick={() => go('/studio/packs')}>Packs</button>
          </div>
        </div>
        {path === '/studio/sudoku' ? <Studio key={account.id} account={account} onPublish={() => { void refreshCatalog() }}/>
          : <PackStudio key={account.id} account={account} levels={catalog} onPublish={() => perform(() => refreshPacks())}/>}
      </> : <section className="panel"><h1>Access required</h1><a className="secondary" href="/studio" onClick={event => link(event, '/studio')}>Studio games</a></section>
      : inAdmin && online && account?.role === 'admin' ? <>
        <Admin key={account.id} account={account} onCatalogChange={() => { void refreshCatalog() }}/>
      </>
      : <section className="panel"><h1>Access required</h1><p>Sign in with an authorized account.</p><button className="secondary" onClick={() => go('/')}>Return to library</button></section>}
      </Suspense>
    </main>
    {dialog && <div className="settings-overlay" onClick={() => showDialog(undefined)}>
      <section className={'settings-panel' + (dialog === 'sudoku' ? ' sudoku-theme' : '')}
        role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><h2 id="settings-title">
          {dialog === 'display' ? 'Device settings' : dialog === 'sudoku' ? 'Sudoku settings' : 'Account settings'}
        </h2><button autoFocus className="secondary" onClick={() => showDialog(undefined)}>Close</button></div>
        {dialog === 'display' && <>
          <label className="setting-row">Theme<select value={preference}
            onChange={event => onThemeChange(themePreference(event.target.value))}>
            <option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option>
          </select></label>
          <label className="setting-row">E-reader mode<input type="checkbox" checked={reader} onChange={event => {
            localStorage.setItem('aviarium:reader', event.target.checked ? 'on' : 'off'); setReader(event.target.checked)
          }}/></label>
          <label className="setting-row">Manage installs<input type="checkbox" checked={manageInstalls} onChange={event => {
            const enabled = event.target.checked
            localStorage.setItem('aviarium:manage-installs', enabled ? 'on' : 'off')
            setManageInstalls(enabled)
          }}/></label>
          <p className="muted">These settings apply to this device.</p>
          {account?.testRole && <>
            <h3>Test environment</h3>
            <label className="setting-row">Test user role<select value={account.testRole} disabled={!online || changingRole}
              onChange={event => changeTestRole(event.target.value as TestRole)}>
              <option value="user">User</option><option value="editor">Sudoku Editor</option><option value="admin">Admin</option>
            </select></label>
          </>}
        </>}
        {dialog === 'sudoku' && ([['mistakes', 'Highlight conflicts'], ['timer', 'Show timer'], ['hints', 'Enable hints'],
          ['autoNotes', 'Show Auto notes button'], ['autoNoteDeletion', 'Automatically remove conflicting notes']] as const)
          .map(([key, label]) => <label className="setting-row" key={key}>{label}<input type="checkbox" checked={prefs[key]}
            onChange={event => changePrefs({ [key]: event.target.checked })}/></label>)}
        {dialog === 'account' && account && <>
          <ProfileForm account={account} online={online} refresh={refreshSession}/>
          {!account.testRole && (online ? <div className="button-bar settings-actions">
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
          </div> : <p>Reconnect to switch accounts or sign out.</p>)}
          <AppleInstallHelp/>
        </>}
      </section>
    </div>}
    {inShell && <footer className="frame footer"><span>Aviarium</span><span>Play at your own pace.</span></footer>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
