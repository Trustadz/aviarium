import { canEditGames } from '../../../packages/game-sdk/src/roles.js'
import { liveQuery } from 'dexie'
import type { Locale } from '../../../packages/game-sdk/src/locales.js'
import { I18n, LanguageSelector, knownMessage, useT } from './i18n.js'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, BookOpen, CalendarDays, LogIn, LogOut, Newspaper,
  Pencil, Trophy, Users, WifiOff } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardRemovalNotice } from '../../../packages/game-sdk/src/leaderboards.js'
import { packProgress, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt } from '../../../packages/game-sdk/src/progress.js'
import { api, ApiError, errorMessage, json, type SessionAccount, type TestRole } from './api.js'
import { AccountMenu, ProfileForm } from './AccountSettings.js'
import { News } from './News.js'
import { ContinueGames } from './ContinueGames.js'
import { LibraryHero } from './LibraryHero.js'
import { GameCatalog } from './GameCatalog.js'
import { GameHistory } from './GameHistory.js'
import { GameLeaderboards, LeaderboardBoardView, LeaderboardCatalog, LeaderboardNotice, LeaderboardPackView } from './Leaderboards.js'
import { ResultStandingsPanel } from './ResultStandingsPanel.js'
import { createGameAttempt, gameBoardHref, gameDefinition, hasLeaderboard, packLevels } from './game-definitions.js'
import { ChallengesPage, ChallengeBoard, ChallengeStandingsPanel, type ChallengeDayView, type ChallengeSlotView, type ChallengeReplayView } from './Challenges.js'
import type { WebGame } from './game-web.js'
import { GameMenu } from './GameMenu.js'
import { GameGuide } from './GameGuide.js'
import { CelebrationOverlay } from './CelebrationOverlay.js'
import { registerOffline, useGameDownloads } from './offline.js'
import { randomId } from './random.js'
import { findGame, games } from './registry.js'
import { useSession } from './session.js'
import { PackCards, PackRoadmap, packApi, packPath } from './GamePacks.js'
import { canGoBack, navigationLayer, pushLayer, replaceLayer, seedHistory } from './navigation.js'
import { cacheLevels, db, deleteSavedGame, isResumable, levelKey, listSessions, packCompletionEvents, localProfile, saveLocal,
  sync, syncPreferences, updatePreferences, writeAttempt, type LocalSession, type MutationExtras, type ProfilePreferences } from './storage.js'
import './styles.css'

const mutationExtras: MutationExtras = (game, level) => gameDefinition(game)?.generation?.describe?.(level as never)
const Admin = lazy(() => import('./Admin.js'))

type ColorScheme = 'light' | 'dark'
type PackLoadStatus = 'loading' | 'ready' | 'failed'
const packGames = games.filter(game => game.packs)
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
  const t = useT()
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia('(display-mode: standalone)').matches
  if (!appleMobile || standalone) return null

  return <details className="install-help">
    <summary>{t("Install Aviarium")}</summary>
    <p>{t('Open Aviarium in Safari. Tap Share, then Add to Home Screen. If offered, turn on Open as Web App, then tap Add.')}</p>
    <p>{t('If the action is missing, look under View More or Edit Actions in the Share menu.')}</p>
  </details>
}

function setBrowserTheme(element: HTMLElement | null, property: '--surface' | '--game-page') {
  if (!element) return
  const styles = getComputedStyle(element)
  const color = element.classList.contains('pack-palette') ? styles.backgroundColor : styles.getPropertyValue(property).trim()
  if (!color) return
  document.documentElement.style.setProperty('--window-background', color)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

function Application() {
  const session = useSession()
  const accountId = session.account?.id
  const profile = accountId ?? (session.localPlay ? localProfile : undefined)
  const [settings, setSettings] = useState<{ profile: string; locale?: Locale; pendingLocale?: Locale }>()
  const [languageError, setLanguageError] = useState<{ profile: string; message: string }>()
  const activeSettings = settings?.profile === profile ? settings : undefined

  useEffect(() => {
    if (!profile) return
    const subscription = liveQuery(() => db.prefs.get(profile)).subscribe({
      next: value => setSettings({ profile, locale: value?.data.locale, pendingLocale: value?.pending.locale }),
      error: error => setLanguageError({ profile, message: errorMessage(error) }),
    })
    return () => subscription.unsubscribe()
  }, [profile])

  useEffect(() => {
    if (!accountId || !session.online || !activeSettings?.pendingLocale) return
    void syncPreferences(accountId).then(
      () => setLanguageError(error => error?.profile === accountId ? undefined : error),
      error => setLanguageError({ profile: accountId, message: errorMessage(error) }),
    )
  }, [accountId, session.online, activeSettings?.pendingLocale])

  return <I18n profileLocale={activeSettings?.locale} onProfileLocale={profile ? value => {
    setLanguageError(undefined)
    void updatePreferences(profile, { locale: value })
      .catch(error => setLanguageError({ profile, message: errorMessage(error) }))
  } : undefined}>
    <App session={session} languageError={languageError?.profile === profile ? languageError?.message ?? '' : ''}/>
  </I18n>
}

function App({ session, languageError }: { session: ReturnType<typeof useSession>; languageError: string }) {
  const t = useT()
  const { account, localPlay, checking, online, signIn, refresh, forget } = session
  const [preference, setPreference] = useState(() => themePreference(localStorage.getItem(themeKey)))
  const system = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme)
  const theme = preference === 'auto' ? system : preference
  const signInPage = useRef<HTMLElement>(null)
  useLayoutEffect(() => setBrowserTheme(signInPage.current, '--surface'), [account, localPlay, theme])
  useGameDownloads(undefined, online, !checking && !account && !localPlay)
  const [activate, setActivate] = useState<() => void>()
  useEffect(() => { void registerOffline(handler => setActivate(() => handler)).catch(() => undefined) }, [])
  useEffect(() => {
    if (activate && online && !checking && !account && !localPlay) activate()
  }, [account, activate, checking, localPlay, online])

  if (account || localPlay) return <Library key={account?.id ?? localProfile} account={account} online={online} activate={activate}
    refreshSession={refresh} signOut={forget} languageError={languageError} theme={theme} preference={preference} onThemeChange={value => {
      localStorage.setItem(themeKey, value)
      setPreference(value)
    }}/>

  return <main ref={signInPage} className="app login-page" data-theme={theme}>
    <section className="panel login-panel" aria-labelledby="login-title">
      <img src="/aviarium.svg" alt="" width="64" height="64"/>
      <h1 id="login-title">Aviarium</h1>
      {checking ? <p role="status">{t("Checking session…")}</p> : <>
        <a className="primary" href="/api/auth/login"><LogIn size={18}/>{" "}{t("Login with Pocket ID")}</a>
        {!online ? <p>{t("Connect to the internet to sign in.")}</p>
          : signIn === false && <p>{t("Pocket ID setup is required on this server.")}</p>}
      </>}
      <LanguageSelector/>
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
  languageError: string
  theme: ColorScheme
  preference: ThemePreference
  onThemeChange: (value: ThemePreference) => void
}

function Library({ account, online, activate, refreshSession, signOut, languageError, theme, preference, onThemeChange }: LibraryProps) {
  const t = useT()
  const accountId = account?.id
  const profile = accountId ?? localProfile
  const catalogKey = 'aviarium:catalog:' + profile
  const packIndexKey = 'aviarium:pack-index:' + profile
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [catalog, setCatalog] = useState<GameLevel[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(catalogKey) ?? 'null')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [savedLevels, setSavedLevels] = useState<ReadonlyMap<string, GameLevel>>(new Map())
  const [packs, setPacks] = useState<PackRevision[]>([])
  const latestCatalog = useRef(catalog)
  const latestPacks = useRef(packs)
  const [packStatuses, setPackStatuses] = useState<Record<string, PackLoadStatus>>({})
  const [packRetry, setPackRetry] = useState(0)
  const [viewedPack, setViewedPack] = useState<PackRevision>()
  const [packProblem, setPackProblem] = useState('')
  const [completions, setCompletions] = useState<string[]>([])
  const [prefs, setPrefs] = useState<ProfilePreferences>({})
  const [reader, setReader] = useState(() => localStorage.getItem('aviarium:reader') === 'on')
  const [manageInstalls, setManageInstalls] = useState(() => localStorage.getItem('aviarium:manage-installs') === 'on')
  const [active, setActive] = useState<{
    session: LocalSession; level: GameLevel; game: WebGame; head: LocalSession; pack?: PackRevision; parent: string
    playerPath?: string
    challenge?: { occurrenceId: string; slotId: string; game: string; attemptId: string; endsAt: string }
  }>()
  const [challengeSummary, setChallengeSummary] = useState<{ enabled: boolean; open: number }>()
  const [challengeRefresh, setChallengeRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All games')
  const [dialog, showDialog] = useState<'display' | 'game' | 'account'>()
  const [celebrationPreview, setCelebrationPreview] = useState(false)
  const [changingRole, setChangingRole] = useState(false)
  const [notice, setNotice] = useState('')
  const [networkNotice, setNetworkNotice] = useState('')
  const [removalNotices, setRemovalNotices] = useState<LeaderboardRemovalNotice[]>([])
  const openGame = games.find(game => path === game.url || path.startsWith(game.url + '/'))
  const studioMatch = /^\/studio\/([a-z0-9-]+)(\/admin)?$/.exec(path)
  const studioGame = path === '/studio/packs' ? findGame('sudoku') : studioMatch && findGame(studioMatch[1])
  const adminPackStudio = Boolean(studioMatch?.[2])
  const { installed, remove, recordActivity } = useGameDownloads(studioGame?.id ?? openGame?.id, online)
  const canPlay = (game: WebGame) => online || installed.includes(game.id)
  const saves = useRef<Promise<void>>(Promise.resolve())
  const refreshCatalog = useCallback(async () => {
    const requests = games.map(game => ({ game: game.id,
      promise: api<GameLevel[]>('/games/' + game.id + '/catalog', undefined, accountId) }))
    const results = await Promise.allSettled(requests.map(request => request.promise))
    const updated = new Map<string, GameLevel[]>()
    for (const [index, result] of results.entries()) {
      const game = requests[index].game
      if (result.status === 'fulfilled') updated.set(game, result.value.map(level => ({ ...level, game })))
      else if (result.reason instanceof ApiError && [401, 409].includes(result.reason.status)) void refreshSession()
    }
    if (!updated.size) return
    const levels = [
      ...latestCatalog.current.filter(level => !updated.has(level.game ?? 'sudoku')),
      ...[...updated.values()].flat(),
    ]
    latestCatalog.current = levels
    setCatalog(levels)
    try { localStorage.setItem(catalogKey, JSON.stringify(levels)) } catch { /* The current catalog stays available. */ }
    await cacheLevels(levels).catch(() => undefined)
  }, [accountId, catalogKey, refreshSession])
  const refreshPacks = useCallback(async (signal?: AbortSignal) => {
    if (online) setPackStatuses(Object.fromEntries(packGames.map(game => [game.id, 'loading'])))
    const results = online ? await Promise.allSettled(packGames.map(game =>
      api<PackRevision[]>(packApi(game.id), { signal }, accountId))) : []
    const updated = new Map<string, PackRevision[]>()
    const statuses = Object.fromEntries(packGames.map((game, index): [string, PackLoadStatus] => {
      const result = results[index]
      if (result?.status === 'fulfilled') updated.set(game.id, result.value)
      return [game.id, result?.status === 'rejected' ? 'failed' : 'ready']
    }))
    let cached: PackRevision[] = []
    if (updated.size < packGames.length) {
      try {
        const index: unknown = JSON.parse(localStorage.getItem(packIndexKey) ?? '[]')
        if (Array.isArray(index) && index.every(key => typeof key === 'string')) {
          const records = await db.packs.bulkGet(index)
          cached = records.flatMap(record => record ? [record.pack] : [])
        }
      } catch { /* Pack cards can still use in-memory data. */ }
    }
    if (signal?.aborted) return
    const liveGames = new Set(latestPacks.current.map(pack => pack.data.game))
    const published = [
      ...latestPacks.current.filter(pack => !updated.has(pack.data.game)),
      ...cached.filter(pack => !updated.has(pack.data.game) && !liveGames.has(pack.data.game)),
      ...[...updated.values()].flat(),
    ]
    latestPacks.current = published
    setPacks(published)
    setPackStatuses(statuses)
    if (updated.size) {
      const records = published.map(pack => ({ key: levelKey(pack.id, pack.revision), pack }))
      void db.packs.bulkPut(records).then(() => {
        localStorage.setItem(packIndexKey, JSON.stringify(records.map(record => record.key)))
      }).catch(() => undefined)
    }
  }, [accountId, online, packIndexKey])
  const findPack = useCallback(async (game: WebGame, id: string, revision: number, review = false) => {
    const key = levelKey(id, revision)
    const cached = await db.packs.get(key).catch(() => undefined)
    if (cached?.pack.data.game === game.id && (!review || !online)) return cached.pack
    if (!online) throw new Error('Connect to open this pack for the first time.')
    try {
      const { ownedByViewer, ...pack } = await api<PackRevision>(`${packApi(game.id)}/${id}/${revision}`, undefined, accountId)
      void db.packs.put({ key, pack }).catch(() => undefined)
      return { ...pack, ownedByViewer }
    } catch (error) {
      if (cached?.pack.data.game === game.id) return cached.pack
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
    setPrefs(settings?.data ?? {})
    setCompletions(completed.map(item => levelKey(item.level, item.revision)))
  }, [profile])
  useLayoutEffect(() => {
    seedHistory(location.pathname, location.search, location.hash)
  }, [])
  useEffect(() => {
    const locationChanged = () => {
      setActive(undefined)
      showDialog(undefined)
      setPath(location.pathname.replace(/\/$/, '') || '/')
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) showDialog(undefined)
    }
    window.addEventListener('popstate', locationChanged)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('popstate', locationChanged)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  useEffect(() => { if (online) void refreshCatalog() }, [refreshCatalog, online])
  useEffect(() => {
    const controller = new AbortController()
    void refreshPacks(controller.signal)
    return () => controller.abort()
  }, [packRetry, refreshPacks])
  useEffect(() => {
    const match = openGame?.packs && /^\/packs\/([a-z0-9-]+)\/(\d+)$/.exec(path.slice(openGame.url.length))
    if (!match || !openGame) return
    let cancelled = false
    setViewedPack(undefined); setPackProblem('')
    void findPack(openGame, match[1], Number(match[2]), true).then(pack => {
      if (!cancelled) setViewedPack(pack)
    }, error => { if (!cancelled) setPackProblem(errorMessage(error)) })
    return () => { cancelled = true }
  }, [path, openGame, findPack])
  useEffect(() => { void refreshLocal().catch(error => setNotice(errorMessage(error))) }, [refreshLocal, active])
  useEffect(() => {
    if (!accountId || !online) { setChallengeSummary(undefined); return }
    let current = true
    void api<{ enabled: boolean; open: number }>('/challenges/summary', undefined, accountId).then(
      value => { if (current) setChallengeSummary(value) },
      () => { if (current) setChallengeSummary(undefined) })
    return () => { current = false }
  }, [accountId, online, path, challengeRefresh])
  useEffect(() => {
    if (!accountId || !online) return
    let current = true
    void api<{ notices: LeaderboardRemovalNotice[] }>('/leaderboards/notices', undefined, accountId).then(
      value => { if (current) setRemovalNotices(value.notices) }, () => undefined)
    return () => { current = false }
  }, [accountId, online])
  useEffect(() => {
    if (!accountId || !online || active) return
    let current = true
    const run = () => {
      if (document.hidden) return
      void saves.current.catch(() => undefined).then(() => sync(profile, mutationExtras)).then(() => {
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

  function go(next: string) {
    setActive(undefined)
    if ((location.pathname.replace(/\/$/, '') || '/') !== next) {
      pushLayer(next)
      setPath(next)
      window.scrollTo(0, 0)
    }
  }
  function link(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); go(next)
  }
  /** Open a game's Studio from its menu, remembering the way back. */
  function openStudio(event: MouseEvent<HTMLAnchorElement>, gameId: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setActive(undefined)
    pushLayer('/studio/' + gameId, { studioOrigin: 'game' })
    setPath('/studio/' + gameId)
    window.scrollTo(0, 0)
  }
  function back(fallback: string) {
    if (canGoBack()) history.back()
    else go(fallback)
  }
  function backLink(event: MouseEvent<HTMLAnchorElement>, fallback: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); back(fallback)
  }
  function record(attempt: NonNullable<typeof active>, data: GameAttempt) {
    recordActivity(attempt.game.id)
    const result = saves.current.catch(() => undefined).then(async () => {
      attempt.head = await writeAttempt(attempt.head, data)
      if (attempt.head.id !== attempt.session.id) setNotice('This attempt changed in another tab or device. Your moves are saved in a separate copy.')
      if (data.completed && online && account)
        void sync(profile, mutationExtras).then(() => {
          if (attempt.challenge) setChallengeRefresh(value => value + 1)
        }).catch(() => undefined)
    })
    saves.current = result
    return result
  }
  async function open(game: WebGame, level: GameLevel, existing?: LocalSession, suppliedPack?: PackRevision,
    options: { replace?: boolean } = {}) {
    if (!canPlay(game)) throw new Error(game.connectMessage)
    if (level.source === 'Challenge' && !existing?.challenge)
      throw new Error('Open this from Daily Challenges.')
    const pack = suppliedPack ?? (level.pack && !level.pack.legacyStandalone ? await findPack(game, level.pack.id, level.pack.revision) : undefined)
    if (!existing && pack && level.pack &&
        !packProgress(pack, packCompletionEvents(completed, sessions)).playable[level.pack.stop - 1])
      throw new Error('Solve the previous stop in this pack first.')
    const session = existing ?? { id: randomId(), revision: 0, data: createGameAttempt(game.id, level, pack),
      archived: false, profile, updated: Date.now(), dirty: true }
    await cacheLevels([level])
    if (!existing) await saveLocal(session)
    const parent = pack ? packPath(pack) : game.url
    if (options.replace) {
      replaceLayer(game.url, { player: true })
    } else {
      // Lay down the selector and menu when a game starts from a shortcut
      // such as Continue or History, so back never skips a level.
      if (path !== parent) {
        if (path === game.url) {
          if (parent !== game.url) pushLayer(parent)
        } else if (path.startsWith(game.url + '/')) {
          replaceLayer(parent)
        } else {
          if (path !== game.url) pushLayer(game.url)
          if (parent !== game.url) pushLayer(parent)
        }
      }
      pushLayer(game.url, { player: true })
    }
    setNotice(''); setActive({ game, session, level, head: session, pack, parent, playerPath: game.url })
    setPath(game.url)
    window.scrollTo(0, 0)
  }
  async function openChallengeSession(session: LocalSession, level: GameLevel, game: WebGame) {
    const claim = session.challenge
    const occurrenceId = claim?.occurrenceId
    const slotId = claim?.slotId
    const endsAt = claim?.endsAt
    if (!claim || !occurrenceId || !slotId || !endsAt) throw new Error('This daily challenge is unavailable.')
    const dayPath = '/challenges/' + occurrenceId
    const playerPath = dayPath + '/' + game.id + '/play'
    const challenge = { attemptId: claim.attemptId, status: claim.status, ranked: claim.ranked, invalid: claim.invalid,
      slotId, occurrenceId, endsAt, game: game.id }
    if (path !== dayPath) {
      if (path.startsWith('/challenges/')) replaceLayer(dayPath)
      else pushLayer(dayPath)
    }
    pushLayer(playerPath, { player: true })
    recordActivity(game.id)
    setNotice('')
    setActive({ game, session, level, head: session, parent: dayPath, playerPath, challenge })
    setPath(playerPath)
    setChallengeRefresh(value => value + 1)
    window.scrollTo(0, 0)
  }

  interface ChallengeStartResponse {
    attemptId: string
    sessionId: string
    startedAt: string
    resumed: boolean
    occurrence: { id: string; periodKey: string; endsAt: string; timezone: string }
    save?: { data: GameAttempt; revision: number; archived: boolean; updatedAt?: number }
    slot: {
      id: string; game: string; position: number; level: GameLevel
      options: Record<string, unknown>; rules: Record<string, unknown>
    }
  }

  async function startChallenge(day: ChallengeDayView, slot: ChallengeSlotView) {
    if (!accountId || !online) throw new Error('Connect to start a daily challenge.')
    if (!day.occurrence) throw new Error('This daily challenge is unavailable.')
    const response = await api<ChallengeStartResponse>('/challenges/slots/' + encodeURIComponent(slot.id) + '/start',
      { method: 'POST' }, accountId)
    const game = findGame(response.slot.game)
    if (!game) throw new Error('This game is not available in this version.')
    const level = response.slot.level
    await cacheLevels([level])
    const challenge = {
      attemptId: response.attemptId,
      slotId: slot.id,
      occurrenceId: day.occurrence.id,
      endsAt: response.occurrence.endsAt,
      game: slot.game,
    }
    const existing = await db.sessions.get(response.sessionId)
    const session: LocalSession = existing
      ? { ...existing, challenge }
      : response.save
        ? { id: response.sessionId, revision: response.save.revision, data: response.save.data as GameAttempt,
            archived: response.save.archived, profile, updated: response.save.updatedAt ?? Date.now(), dirty: false, challenge }
        : { id: response.sessionId, revision: 0, data: createGameAttempt(game.id, level), archived: false,
            profile, updated: Date.now(), dirty: true, challenge }
    await saveLocal(session)
    await openChallengeSession(session, level, game)
  }

  async function playOtherChallenge(gameId: string) {
    const day = await api<ChallengeDayView>('/challenges', undefined, accountId)
    const slot = day.slots.find(item => item.game === gameId &&
      (item.player.status === 'available' || item.player.status === 'started'))
    if (slot) await startChallenge(day, slot)
  }

  async function playReplay(replay: ChallengeReplayView) {
    const game = findGame(replay.game)
    if (!game) throw new Error('This game is not available in this version.')
    const level = await api<GameLevel>('/games/' + encodeURIComponent(replay.game) + '/quick-play',
      json('POST', { ...replay.options, seed: replay.seed, version: replay.generatorVersion }), accountId)
    await open(game, level)
  }


  async function resume(id: string) {
    const session = await db.sessions.get(id)
    if (!session || session.profile !== profile || !isResumable(session)) throw new Error('This saved game is unavailable.')
    const game = findGame(session.data.game)
    if (!game) throw new Error('This saved game is unavailable.')
    const stored = await db.levels.get(levelKey(session.data.level, session.data.levelRevision))
    if (!stored) throw new Error('This level revision is not downloaded yet.')
    if (session.challenge) {
      await openChallengeSession(session, stored.level, game)
      return
    }
    if (stored.level.pack && (!stored.level.pack.legacyStandalone || session.data.packRevision !== undefined)) {
      const pack = await findPack(game, stored.level.pack.id, session.data.packRevision ?? stored.level.pack.revision)
      const level = packLevels(game.id, pack).find(item => item.id === session.data.level && item.revision === session.data.levelRevision)
      if (level) { await open(game, level, session, pack); return }
    }
    await open(game, stored.level, session)
  }
  async function deleteAttempt(id: string) {
    await saves.current.catch(() => undefined)
    await deleteSavedGame(profile, id)
  }
  function perform(task: () => Promise<unknown>) { void task().catch(error => setNotice(errorMessage(error))) }
  function viewLeaderboard(href: string) {
    perform(async () => {
      await saves.current.catch(() => undefined)
      if (accountId && online) await sync(profile, mutationExtras).catch(() => undefined)
      go(href)
    })
  }
  function acknowledgeRemoval() {
    const removal = removalNotices[0]
    if (!removal) return
    perform(async () => {
      await api(`/leaderboards/notices/${removal.id}/ack`, { method: 'POST' }, accountId)
      setRemovalNotices(items => items.filter(item => item.id !== removal.id))
    })
  }
  function changePrefs(patch: Partial<ProfilePreferences>) {
    setPrefs(current => ({ ...current, ...patch }))
    perform(async () => {
      try { await updatePreferences(profile, patch) }
      catch (error) { await refreshLocal().catch(() => undefined); throw error }
      if (account && !active && online) await sync(profile, mutationExtras)
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
  const continueCards = sessions.flatMap(session => {
    if (!isResumable(session) || session.challenge) return []
    const game = games.find(game => game.id === session.data.game)
    if (!game || (reader && !game.eReader)) return []
    const level = savedLevels.get(levelKey(session.data.level, session.data.levelRevision))
    return [{
      id: session.id,
      game: game.id,
      title: level ? game.levelTitle(t, level) : game.title,
      details: [game.title, level && game.packs?.detail(t, level), session.parentId && t("Conflict copy")].filter(Boolean).join(' · '),
      progress: game.progress(t, session.data),
      preview: game.preview(level, session.data),
      canResume: Boolean(level) && canPlay(game),
    }]
  })
  function continueRow(gameId?: string) {
    return <ContinueGames games={gameId ? continueCards.filter(card => card.game === gameId) : continueCards}
      resume={id => perform(() => resume(id))} remove={id => {
        const card = continueCards.find(card => card.id === id)
        if (!card || !confirm(t('Delete the saved game for “{title}”?', { title: card.title }))) return
        perform(async () => {
          await deleteAttempt(id)
          await refreshLocal()
          if (accountId && online) {
            await sync(profile, mutationExtras)
            await refreshLocal()
          }
        })
      }}/>
  }
  const completed = new Set([...completions, ...sessions.filter(item => item.data.completed)
    .map(item => levelKey(item.data.level, item.data.levelRevision))])

  const canEdit = canEditGames(account?.role)
  const inLibrary = path === '/'
  const challengeParts = path.split('/').filter(Boolean)
  const inChallenges = challengeParts[0] === 'challenges'
  const challengeOccurrence = inChallenges ? challengeParts[1] : undefined
  const challengeGame = inChallenges && challengeParts.length === 3 ? challengeParts[2] : undefined
  const challengeBoard = Boolean(challengeOccurrence && challengeGame)
  const inLeaderboards = path === '/leaderboards'
  const inStudioCatalog = path === '/studio' && canEdit
  const catalogCategories = ['All games', ...new Set(games.flatMap(game => game.tags)), 'Favorites']
  const catalogPage = (game: (typeof games)[number]) => inStudioCatalog ? '/studio/' + game.id : game.url
  const inNews = path === '/news'
  const inStudio = path === '/studio' || Boolean(studioGame)
  const studioOrigin = navigationLayer(history.state)?.studioOrigin
  const studioLeaveLabel = studioOrigin === 'game' && studioGame ? t('{game} menu', { game: studioGame.title }) : t('Studio')
  const inAdmin = path === '/admin'
  const inAbout = path === '/about'
  const playingNow = active && path === (active.playerPath ?? active.game.url) ? active : undefined
  const activeGame = openGame ?? playingNow?.game
  const themeGame = activeGame ?? studioGame
  const inGame = Boolean(openGame) || Boolean(playingNow)
  const leaderboardTail = openGame && path.startsWith(openGame.url + '/leaderboards')
    ? path.slice((openGame.url + '/leaderboards').length) : undefined
  let leaderboardBoardKey: string | undefined
  let leaderboardPack: { id: string; revision: number } | undefined
  if (leaderboardTail?.startsWith('/board/')) {
    try { leaderboardBoardKey = decodeURIComponent(leaderboardTail.slice('/board/'.length)) } catch { leaderboardBoardKey = undefined }
  } else if (leaderboardTail?.startsWith('/pack/')) {
    const [id, revision] = leaderboardTail.slice('/pack/'.length).split('/')
    if (id && Number.isInteger(Number(revision))) leaderboardPack = { id: decodeURIComponent(id), revision: Number(revision) }
  }
  const activeRemoval = removalNotices[0]
  const inShell = !inGame
  const playing = playingNow
  const playPack = playing?.pack
  const surface = inGame ? 'game' : inStudio ? 'studio' : 'library'
  const app = useRef<HTMLDivElement>(null)
  const gameSurface = useRef<HTMLElement>(null)
  useLayoutEffect(() => setBrowserTheme(themeGame ? gameSurface.current : app.current, surface === 'game' ? '--game-page' : '--surface'),
    [reader, surface, theme, themeGame?.id, playPack?.data.theme])
  const settings = activeGame?.settings
  const bestMs = playing ? Math.min(...sessions.filter(item => item.id !== playing.session.id &&
    item.data.game === playing.game.id && item.data.level === playing.level.id &&
    item.data.levelRevision === playing.level.revision && item.data.completed).map(item => item.data.elapsedMs)) : Number.POSITIVE_INFINITY

  return <div ref={app} className={'app' + (reader ? ' reader' : '') + (inShell ? ' app-shell' : '')} data-theme={theme} data-surface={surface}>
    {inShell && <>
      <header className="site-header"><div className="frame header-frame">
        <a className="brand" href="/" aria-label={t("Aviarium home")} onClick={event => link(event, '/')}><img src="/aviarium.svg" alt=""/>
          <span>{studioGame ? t('{game} Studio', { game: studioGame.title }) : inStudio ? t("Studio") : inNews ? t("News") : inAdmin ? t("Administration") : inAbout ? t("About") : inChallenges ? t("Daily Challenges") : inLeaderboards ? t("Leaderboards") : 'Aviarium'}</span>
        </a>
        {!online && <span className="offline-tag"><WifiOff size={16}/>{" "}{t("Offline")}</span>}
      </div></header>
      <div className="app-rail">
        <nav aria-label={t("Main navigation")} className="app-destinations">
          <a href="/" aria-current={inLibrary ? 'page' : undefined} onClick={event => link(event, '/')}><BookOpen size={21}/><span>{t("Library")}</span></a>
          {account && challengeSummary?.enabled !== false && <a href="/challenges" aria-current={inChallenges ? 'page' : undefined}
            aria-label={challengeSummary?.open ? t('Daily Challenges, {count} open', { count: challengeSummary.open }) : t('Daily Challenges')}
            onClick={event => link(event, '/challenges')}><CalendarDays size={21}/><span>{t('Daily')}</span>
            {Boolean(challengeSummary?.open) && <span className="nav-badge" aria-hidden="true">{challengeSummary!.open > 9 ? '9+' : challengeSummary!.open}</span>}</a>}
          {account && <a href="/leaderboards" aria-current={inLeaderboards ? 'page' : undefined}
            onClick={event => link(event, '/leaderboards')}><Trophy size={21}/><span>{t("Leaderboards")}</span></a>}
          <a href="/news" aria-current={inNews ? 'page' : undefined} onClick={event => link(event, '/news')}><Newspaper size={21}/><span>{t("News")}</span></a>
        </nav>
        <AccountMenu account={account} open={showDialog} about={() => go('/about')}
          administration={online && account?.role === 'admin' ? () => go('/admin') : undefined}/>
      </div>
    </>}
    <main ref={gameSurface} className={(inGame ? 'game-frame' : 'frame main-frame') + (themeGame ? ' game-theme ' + themeGame.theme : '') + (studioGame ? ' studio-game-canvas' : '') +
      (playPack ? ` pack-palette pack-${playPack.data.theme}` : '')}>
      {notice && <div className="notice" role="alert">{knownMessage(t, notice)}<button onClick={() => setNotice('')}>{t("Dismiss")}</button></div>}
      {inLibrary && networkNotice && <p role="status" className="network-notice">{t("Sync delayed.")}{" "}{knownMessage(t, networkNotice)}</p>}
      {inLibrary && online && activate && <div className="notice">{t("An Aviarium update is ready.")}<button onClick={activate}>{t("Reload")}</button></div>}
      <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
      {inLibrary || inStudioCatalog ? <>
        {inLibrary && continueRow()}
        {inLibrary && <LibraryHero catalog={catalog} packs={packs} reader={reader} open={game => go(game.url)}/>}
        <GameCatalog studio={inStudioCatalog}
          action={inLibrary && canEdit && <a className="secondary studio-door" href="/studio"
            onClick={event => link(event, '/studio')}><Pencil size={16} aria-hidden="true"/> {t('Studio')}</a>}
          games={games.filter(game => !reader || game.eReader).map(game => ({
            ...game, description: t(inStudioCatalog ? game.studioDescription ?? game.description : game.description), href: catalogPage(game),
            artClass: game.theme, art: game.preview(game.sample?.(catalog)),
            favorite: Boolean(game.favorite && prefs[game.favorite]),
            toggleFavorite: game.favorite ? () => changePrefs({ [game.favorite!]: !prefs[game.favorite!] }) : undefined,
            removeDownload: manageInstalls && installed.includes(game.id) ? () => perform(() => remove(game.id)) : undefined,
          }))} categories={catalogCategories} category={category} setCategory={setCategory} query={query} setQuery={setQuery} link={link}/>
      </>
      : inLeaderboards ? <LeaderboardCatalog games={games} sessions={sessions} accountId={account?.id} online={online} link={link}/>
      : playing ? <playing.game.Player key={playing.session.id} session={playing.session} level={playing.level} pack={playing.pack}
        preferences={prefs} reader={reader} bestMs={playing.challenge ? undefined : Number.isFinite(bestMs) ? bestMs : undefined}
        testMode={Boolean(account?.testRole)} persist={data => record(playing, data)}
        challenge={playing.challenge ? { occurrenceId: playing.challenge.occurrenceId, slotId: playing.challenge.slotId,
          game: playing.challenge.game, attemptId: playing.challenge.attemptId, endsAt: playing.challenge.endsAt } : undefined}
        standingsPanel={playing.challenge ? <ChallengeStandingsPanel occurrenceId={playing.challenge.occurrenceId}
          gameId={playing.challenge.game} accountId={account?.id} online={online}
          onPlayOther={game => perform(() => playOtherChallenge(game))}/>
          : hasLeaderboard(playing.game.id) ? <ResultStandingsPanel game={playing.game} level={playing.level}
            accountId={account?.id} online={online}/> : undefined}
        leaderboard={playing.challenge
          ? { open: () => go('/challenges/' + playing.challenge!.occurrenceId + '/' + playing.challenge!.game) }
          : hasLeaderboard(playing.game.id) ? { open: () => viewLeaderboard(gameBoardHref(playing.game.id, playing.level)!) } : undefined}
        openSettings={settings ? () => showDialog('game') : undefined}
        leave={() => perform(async () => {
          await saves.current.catch(() => undefined)
          try { await refreshLocal() }
          finally { back(playing.parent) }
        })}
        restart={playing.challenge ? () => undefined : () => perform(async () => {
          await deleteAttempt(playing.head.id)
          await open(playing.game, playing.level, undefined, playing.pack, { replace: true })
        })}/>
      : inChallenges && challengeBoard ? <ChallengeBoard occurrenceId={challengeOccurrence!} gameId={challengeGame!}
        accountId={account?.id} online={online} back={() => go('/challenges/' + challengeOccurrence)}/>
      : inChallenges ? <ChallengesPage occurrenceId={challengeOccurrence} accountId={account?.id} online={online} link={link}
        start={(day, slot) => perform(() => startChallenge(day, slot))}
        replay={replay => perform(() => playReplay(replay))}
        board={(occurrenceId, game) => go('/challenges/' + occurrenceId + '/' + game)}
        openDay={occurrenceId => go('/challenges/' + occurrenceId)}
        openToday={() => go('/challenges')}/>
      : openGame && hasLeaderboard(openGame.id) && path === openGame.url + '/leaderboards' ? <GameLeaderboards game={openGame}
        accountId={account?.id} online={online} link={link} back={() => go(openGame.url)}/>
      : openGame && hasLeaderboard(openGame.id) && leaderboardBoardKey !== undefined ? <LeaderboardBoardView game={openGame}
        boardKey={leaderboardBoardKey} accountId={account?.id} online={online}
        back={() => go(openGame.url + '/leaderboards')} play={level => perform(() => open(openGame, level))}
        openGame={() => go(openGame.url)}/>
      : openGame && hasLeaderboard(openGame.id) && leaderboardPack ? <LeaderboardPackView game={openGame} packId={leaderboardPack.id}
        revision={leaderboardPack.revision} accountId={account?.id} online={online}
        back={() => go(openGame.url + '/leaderboards')} link={link}/>
      : openGame?.guide && path === openGame.url + '/how-to' ? <GameGuide game={openGame.title} menuUrl={openGame.url}
        sections={openGame.guide} leave={event => backLink(event, openGame.url)}/>
      : openGame && path === openGame.url + '/history' ? <GameHistory game={openGame} sessions={sessions.filter(item => !item.challenge)} levels={savedLevels} packs={packs}
        leave={() => back(openGame.url)} replay={level => perform(() => open(openGame, level))} canPlay={canPlay(openGame)}/>
      : openGame?.packs && path.startsWith(openGame.url + '/packs/') ? viewedPack && packPath(viewedPack) === path
        ? <PackRoadmap game={openGame.id} presentation={openGame.packs} pack={viewedPack} completed={completed} sessions={sessions} canPlay={canPlay(openGame)}
          canExport={Boolean(online && canEdit && (account?.role === 'admin' || viewedPack.ownedByViewer))}
          leave={() => back(openGame.url)} play={level => perform(() => {
            const existing = sessions.find(item => isResumable(item) && item.data.game === openGame.id &&
              item.data.level === level.id && item.data.levelRevision === level.revision)
            return existing ? resume(existing.id) : open(openGame, level, undefined, viewedPack)
          })}/>
        : <section className="catalog"><button className="text-button" onClick={() => back(openGame.url)}>{t(openGame.packs.menuLabel)}</button>
          <p role={packProblem ? 'alert' : 'status'}>{(packProblem && knownMessage(t, packProblem)) || t('Loading pack…')}</p></section>
      : openGame && path === openGame.url ? <GameMenu title={openGame.title} leave={() => back('/')}
        leaderboard={hasLeaderboard(openGame.id) ? { href: openGame.url + '/leaderboards',
          open: event => link(event, openGame.url + '/leaderboards') } : undefined}
        editor={canEdit ? { href: '/studio/' + openGame.id, open: event => openStudio(event, openGame.id) } : undefined}
        history={() => go(openGame.url + '/history')}
        settings={settings && { label: t(settings.title), open: () => showDialog('game') }}
        guide={openGame.guide && { href: openGame.url + '/how-to', open: event => link(event, openGame.url + '/how-to') }}>
        {continueRow(openGame.id)}
        {!canPlay(openGame) && <p className="notice">{t(openGame.connectMessage)}</p>}
        {openGame.menu?.({ canPlay: canPlay(openGame), online, profile, params: new URLSearchParams(location.search),
          launch: level => open(openGame, level), perform })}
        {openGame.packs && <PackCards game={openGame.id} presentation={openGame.packs} packs={packs.filter(pack => pack.data.game === openGame.id)}
          completed={completed} status={packStatuses[openGame.id] ?? 'loading'} retry={() => setPackRetry(attempt => attempt + 1)} open={pack => go(packPath(pack))}/>}
      </GameMenu>
      : inNews ? <News account={account} online={online}/>
      : inAbout ? <section className="panel about-page" aria-labelledby="about-heading">
        <h1 id="about-heading">{t("About Aviarium")}</h1>
        <p>{t('Version {version}', { version: import.meta.env.VITE_AVIARIUM_VERSION })}</p>
        <p>{t('Aviarium is a self-hosted puzzle library. Start with Sudoku, play the same published puzzles as everyone else, and pick up where you left off. You can download games to play offline, and creators can use Studio to build and share their own puzzles.')}</p>
        <a className="secondary" href="https://github.com/Trustadz/aviarium">{t("Aviarium on GitHub")}</a>
      </section>
      : studioGame && account && canEdit && (!adminPackStudio || (online && account.role === 'admin')) ? <>
        <studioGame.Studio key={account.id + ':' + studioGame.id + (adminPackStudio ? ':admin' : '')} account={account} online={online}
          admin={adminPackStudio} reader={reader} theme={theme} packs={packs.filter(pack => pack.data.game === studioGame.id)}
          leaveLabel={studioLeaveLabel}
          leave={() => back(adminPackStudio ? '/admin' : '/studio')} onPublish={() => perform(() => refreshPacks())}/>
      </>
      : studioGame && canEdit ? <section className="panel"><h1>{t('Access required')}</h1>
        <a className="secondary" href="/studio" onClick={event => link(event, '/studio')}>{t('Studio')}</a></section>
      : inAdmin && online && account?.role === 'admin' ? <>
        <Admin key={account.id} account={account} openPackStudio={game => go('/studio/' + game + '/admin')} onCatalogChange={() => { void refreshCatalog() }}/>
      </>
      : <section className="panel"><h1>{t("Access required")}</h1><p>{t("Sign in with an authorized account.")}</p><button className="secondary" onClick={() => go('/')}>{t("Return to library")}</button></section>}
      </Suspense>
    </main>
    {activeRemoval && <LeaderboardNotice notice={activeRemoval} onAcknowledge={acknowledgeRemoval}/>}
    {dialog && <div className="settings-overlay" onClick={() => showDialog(undefined)}>
      <section className={'settings-panel' + (dialog === 'game' && openGame ? ' game-theme ' + openGame.theme +
        (playPack ? ` pack-palette pack-${playPack.data.theme}` : '') : '')}
        role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><h2 id="settings-title">
          {dialog === 'display' ? t('Device settings') : dialog === 'game' && settings ? t(settings.title)
            : t(account ? 'Account settings' : 'Player settings')}
        </h2><button autoFocus className="secondary" onClick={() => showDialog(undefined)}>{t("Close")}</button></div>
        {dialog === 'display' && <>
          <label className="setting-row">{t("Theme")}<select value={preference}
            onChange={event => onThemeChange(themePreference(event.target.value))}>
            <option value="auto">{t("Auto")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option>
          </select></label>
          <label className="setting-row">{t("E-reader mode")}<input type="checkbox" checked={reader} onChange={event => {
            localStorage.setItem('aviarium:reader', event.target.checked ? 'on' : 'off'); setReader(event.target.checked)
          }}/></label>
          <label className="setting-row">{t("Manage installs")}<input type="checkbox" checked={manageInstalls} onChange={event => {
            const enabled = event.target.checked
            localStorage.setItem('aviarium:manage-installs', enabled ? 'on' : 'off')
            setManageInstalls(enabled)
          }}/></label>
          <p className="muted">{t("These settings apply to this device.")}</p>
          {account?.testRole && <>
            <h3>{t("Test environment")}</h3>
            <label className="setting-row">{t("Test user role")}<select value={account.testRole} disabled={!online || changingRole}
              onChange={event => changeTestRole(event.target.value as TestRole)}>
              <option value="user">{t("User")}</option><option value="editor">{t("Editor")}</option><option value="admin">{t("Admin")}</option>
            </select></label>
            <h3>{t("Preview puzzle celebration")}</h3>
            <div className="celebration-test-grid">
              <button type="button" className="secondary" onClick={() => setCelebrationPreview(true)}>{t("Budgies")}</button>
            </div>
          </>}
        </>}
        {dialog === 'game' && settings?.toggles.map(setting => <label className="setting-row" key={setting.key}>
          {t(setting.label)}<input type="checkbox" checked={Boolean(prefs[setting.key] ?? setting.default)}
            onChange={event => changePrefs({ [setting.key]: event.target.checked })}/>
        </label>)}
        {dialog === 'account' && <>
          <LanguageSelector/>
          {languageError && <p role="status" className="error">{knownMessage(t, languageError)}</p>}
        </>}
        {dialog === 'account' && account && <>
          <ProfileForm account={account} online={online} refresh={refreshSession}/>
          {!account.testRole && (online ? <div className="button-bar settings-actions">
            <a className="primary" href="/api/auth/login?switch=1" onClick={event => {
              event.preventDefault()
              perform(async () => {
                await saves.current
                await sync(profile, mutationExtras).catch(() => undefined)
                location.assign('/api/auth/login?switch=1')
              })
            }}><Users size={17}/>{" "}{t("Switch account")}</a>
            <button className="secondary" onClick={() => perform(async () => {
              await saves.current
              await sync(profile, mutationExtras).catch(() => undefined)
              await api('/auth/logout', { method: 'POST' }, account.id)
              go('/')
              signOut()
            })}><LogOut size={16}/>{" "}{t("Sign out")}</button>
          </div> : <p>{t("Reconnect to switch accounts or sign out.")}</p>)}
          <AppleInstallHelp/>
        </>}
      </section>
    </div>}
    {celebrationPreview && <CelebrationOverlay preview reader={reader}
      result={{ elapsedMs: 0, stats: [{ label: t('Test environment'), value: t('Preview') }] }}
      actions={[{ label: t('Close'), onClick: () => setCelebrationPreview(false) }]}
      onClose={() => setCelebrationPreview(false)}/>}
  </div>
}

createRoot(document.getElementById('root')!).render(<Application/>)
