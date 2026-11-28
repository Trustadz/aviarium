import { canEditGames } from '../../../packages/game-sdk/src/roles.js'
import { liveQuery } from 'dexie'
import type { Locale } from '../../../packages/game-sdk/src/locales.js'
import { I18n, LanguageSelector, knownMessage, useT } from './i18n.js'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { useIntl } from 'react-intl'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, BookOpen, CalendarDays, CircleHelp, Download, History, KeyRound, LogIn, LogOut, Newspaper,
  Package, Pencil, Settings2, Trophy, Users, WifiOff } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardRemovalNotice } from '../../../packages/game-sdk/src/leaderboards.js'
import { chapterProgress, packProgress, packStopAt, packTheme, upgradePackRevision, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt, PlayOptions } from '../../../packages/game-sdk/src/progress.js'
import { api, ApiError, errorMessage, json, type SessionAccount, type TestRole } from './api.js'
import { AccountMenu, ProfileForm } from './AccountSettings.js'
import { News } from './News.js'
import { ContinueGames, type ContinueGame } from './ContinueGames.js'
import { LibraryHero } from './LibraryHero.js'
import { GameCatalog } from './GameCatalog.js'
import { GameHistory } from './GameHistory.js'
import { GameLeaderboards, LeaderboardBoardView, LeaderboardCatalog, LeaderboardNotice, LeaderboardPackView } from './Leaderboards.js'
import { ChallengesPage, ChallengeBoard, ChallengeStandingsPanel, formatChallengeDate, type ChallengeDayView, type ChallengeSlotView, type ChallengeReplayView } from './Challenges.js'
import type { WebGame } from './game-web.js'
import { GameHeading, GameMenu, GameMenuLinks, type GameMenuItem } from './GameMenu.js'
import { GameGuide } from './GameGuide.js'
import { CelebrationOverlay } from './CelebrationOverlay.js'
import { registerOffline, useGameDownloads } from './offline.js'
import { randomId } from './random.js'
import { findGame, games } from './registry.js'
import { useSession } from './session.js'
import { PackCatalog, PackChapters, PackRoadmap, chapterPath, packApi, packExportUrl, packPath } from './GamePacks.js'
import { packLevels } from './game-definitions.js'
import { canGoBack, navigationLayer, pushLayer, replaceLayer, seedHistory, type ScreenRef } from './navigation.js'
import { cacheLevels, db, deleteSavedGame, isResumable, levelKey, listSessions, packCompletionEvents, localProfile, saveLocal,
  sync, syncPreferences, updatePreferences, writeAttempt, type LocalSession, type MutationExtras, type ProfilePreferences } from './storage.js'
import { isUntouched } from './attempt.js'
import './styles.css'

const mutationExtras: MutationExtras = (game, level) => findGame(game)?.mutationExtras?.(level)
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
  useEffect(() => {
    const controller = new AbortController()
    void registerOffline(handler => setActivate(() => handler), controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [])
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
  const intl = useIntl()
  const accountId = account?.id
  const profile = accountId ?? localProfile
  const packIndexKey = 'aviarium:pack-index:' + profile
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/')
  const [sessions, setSessions] = useState<LocalSession[]>([])
  const [savedLevels, setSavedLevels] = useState<ReadonlyMap<string, GameLevel>>(new Map())
  const [packs, setPacks] = useState<PackRevision[]>([])
  const latestPacks = useRef(packs)
  const [packStatuses, setPackStatuses] = useState<Record<string, PackLoadStatus>>({})
  const [packRetry, setPackRetry] = useState(0)
  const [viewedPack, setViewedPack] = useState<PackRevision>()
  const [packProblem, setPackProblem] = useState('')
  const [completions, setCompletions] = useState<string[]>([])
  const [prefs, setPrefs] = useState<ProfilePreferences>({})
  const [reader, setReader] = useState(() => localStorage.getItem('aviarium:reader') === 'on')
  const [manageInstalls, setManageInstalls] = useState(() => localStorage.getItem('aviarium:manage-installs') === 'on')
  const [active, setActive] = useState<{ session: LocalSession; level: GameLevel; game: WebGame; head: LocalSession; pack?: PackRevision
    parent: string; from?: ScreenRef; persisted: boolean; playerPath?: string
    replay?: { label: string; backLabel?: string }
    challenge?: { occurrenceId: string; slotId: string; game: string; attemptId: string; endsAt: string
      rules?: Record<string, string | number | boolean | null> } }>()
  const [challengeSummary, setChallengeSummary] = useState<{ enabled: boolean; open: number }>()
  const featureChallenges = Boolean(accountId && online && challengeSummary?.enabled)
  const [challengeDay, setChallengeDay] = useState<ChallengeDayView>()
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
  const studioCandidate = path === '/studio/packs' ? games.find(game => game.packs && game.Studio) : studioMatch && findGame(studioMatch[1])
  const studioGame = studioCandidate?.Studio ? studioCandidate : undefined
  const inStudioRoute = path === '/studio' || path.startsWith('/studio/')
  const adminPackStudio = Boolean(studioMatch?.[2])
  const { installed, remove, recordActivity } = useGameDownloads(studioGame?.id ?? openGame?.id, online)
  const canPlay = (game: WebGame) => online || installed.includes(game.id)
  const saves = useRef<Promise<void>>(Promise.resolve())
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
          cached = records.flatMap(record => record ? [upgradePackRevision(record.pack)] : [])
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
    const stored = await db.packs.get(key).catch(() => undefined)
    const cached = stored ? upgradePackRevision(stored.pack) : undefined
    if (cached?.data.game === game.id && (!review || !online)) return cached
    if (!online) throw new Error('Connect to open this pack for the first time.')
    try {
      const { ownedByViewer, ...pack } = await api<PackRevision>(`${packApi(game.id)}/${id}/${revision}`, undefined, accountId)
      void db.packs.put({ key, pack }).catch(() => undefined)
      return { ...pack, ownedByViewer }
    } catch (error) {
      if (cached?.data.game === game.id) return cached
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
  useEffect(() => {
    const controller = new AbortController()
    void refreshPacks(controller.signal)
    return () => controller.abort()
  }, [packRetry, refreshPacks])
  const packRoute = openGame?.packs
    ? /^\/packs\/([a-z0-9-]+)\/(\d+)(?:\/chapters\/([a-z0-9-]+))?$/.exec(path.slice(openGame.url.length))
    : null
  const viewedChapterId = packRoute?.[3]
  useEffect(() => {
    if (!packRoute || !openGame) return
    let cancelled = false
    setViewedPack(current => current && current.id === packRoute[1] &&
      current.revision === Number(packRoute[2]) && current.data.game === openGame.id ? current : undefined)
    setPackProblem('')
    void findPack(openGame, packRoute[1], Number(packRoute[2]), true).then(pack => {
      if (!cancelled) setViewedPack(pack)
    }, error => { if (!cancelled) setPackProblem(errorMessage(error)) })
    return () => { cancelled = true }
  }, [path, openGame, findPack])
  useEffect(() => { void refreshLocal().catch(error => setNotice(errorMessage(error))) }, [refreshLocal, active])
  useEffect(() => {
    if (!accountId || !online) { setChallengeSummary(undefined); setChallengeDay(undefined); return }
    let current = true
    void api<{ enabled: boolean; open: number }>('/challenges/summary', undefined, accountId).then(
      value => { if (current) setChallengeSummary(value) },
      () => { if (current) setChallengeSummary(undefined) })
    return () => { current = false }
  }, [accountId, online, path, challengeRefresh])
  useEffect(() => {
    if (!accountId || !online || path !== '/') { setChallengeDay(undefined); return }
    let current = true
    void api<ChallengeDayView>('/challenges', undefined, accountId).then(
      value => { if (current) setChallengeDay(value) },
      () => { if (current) setChallengeDay(undefined) })
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
    // Time checkpoints and other bookkeeping do not create a saved game. A
    // level opened by mistake stays absent from Continue and the roadmap.
    if (isUntouched(attempt.session.data, data)) return Promise.resolve()
    recordActivity(attempt.game.id)
    const result = saves.current.catch(() => undefined).then(async () => {
      if (!attempt.persisted) {
        await saveLocal(attempt.head)
        attempt.persisted = true
      }
      attempt.head = await writeAttempt(attempt.head, data)
      if (attempt.head.id !== attempt.session.id) setNotice('This attempt changed in another tab or device. Your moves are saved in a separate copy.')
      if (data.completed && attempt.challenge) {
        setChallengeRefresh(value => value + 1)
        // A challenge closes at a fixed time, so post the verified completion
        // now instead of waiting for navigation. This also lets the after-game
        // standings and View leaderboard show the result immediately.
        await sync(profile, mutationExtras).catch(() => undefined)
      }
    })
    saves.current = result
    return result
  }
  async function open(game: WebGame, level: GameLevel, existing?: LocalSession, suppliedPack?: PackRevision,
    options: { replace?: boolean; parent?: string; replay?: { label: string; backLabel?: string };
      playOptions?: PlayOptions } = {}) {
    if (!canPlay(game)) throw new Error(game.connectMessage)
    if (level.source === 'Challenge' && !existing?.challenge)
      throw new Error('Open this from Challenges.')
    const pack = suppliedPack ?? (level.pack && !level.pack.legacyStandalone ? await findPack(game, level.pack.id, level.pack.revision) : undefined)
    const location = pack && level.pack ? packStopAt(pack, level.pack.stop) : undefined
    const chapterId = location?.chapter.id ?? pack?.data.chapters[0]?.id
    const completionEvents = packCompletionEvents(completed, sessions)
    if (pack && location && chapterId && !chapterProgress(pack, completionEvents, chapterId).unlocked)
      throw new Error('Complete the previous chapter to unlock this chapter.')
    if (!existing && pack && location && chapterId &&
        !packProgress(pack, completionEvents, chapterId).playable[location.chapterStop - 1])
      throw new Error('Solve the previous stop in this chapter first.')
    const session = existing ?? { id: randomId(), revision: 0, data: await game.createAttempt(level, pack, options.playOptions),
      archived: false, profile, updated: Date.now(), dirty: true }
    await cacheLevels([level])
    const parent = options.parent ?? (pack && chapterId ? chapterPath(pack, chapterId) : pack ? packPath(pack) : game.url)
    // A new attempt is only written on the first real move. This keeps a
    // mis-click from becoming a resumable game that Back can land on later.
    if (options.replace) {
      replaceLayer(game.url, { player: true })
    } else {
      pushLayer(game.url, { player: true, from: { path } })
    }
    const from = options.replace ? navigationLayer(history.state)?.from : { path }
    setNotice(''); setActive({ game, session, level, head: session, pack, parent, from, persisted: Boolean(existing),
      playerPath: game.url, replay: options.replay })
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
      slotId, occurrenceId, endsAt, game: game.id, rules: claim.rules }
    if (path !== dayPath) {
      if (path.startsWith('/challenges/')) replaceLayer(dayPath)
      else pushLayer(dayPath)
    }
    pushLayer(playerPath, { player: true, from: { path: dayPath } })
    recordActivity(game.id)
    setNotice('')
    setActive({ game, session, level, head: session, parent: dayPath, playerPath, challenge,
      from: { path: dayPath }, persisted: true })
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
      rules: response.slot.rules as Record<string, string | number | boolean | null>,
    }
    const existing = await db.sessions.get(response.sessionId)
    const session: LocalSession = existing
      ? { ...existing, challenge }
      : response.save
        ? { id: response.sessionId, revision: response.save.revision, data: response.save.data as GameAttempt,
            archived: response.save.archived, profile, updated: response.save.updatedAt ?? Date.now(), dirty: false, challenge }
        : { id: response.sessionId, revision: 0, data: await game.createAttempt(level), archived: false,
            profile, updated: Date.now(), dirty: true, challenge }
    await saveLocal(session)
    await openChallengeSession(session, level, game)
  }

  async function playReplay(replay: ChallengeReplayView) {
    const game = findGame(replay.game)
    if (!game) throw new Error('This game is not available in this version.')
    const level = await api<GameLevel>('/games/' + encodeURIComponent(replay.game) + '/quick-play',
      json('POST', { ...replay.options, seed: replay.seed, version: replay.generatorVersion }), accountId)
    await open(game, level, undefined, undefined, {
      ...(replay.occurrenceId ? { parent: '/challenges/' + replay.occurrenceId } : {}),
      replay: { label: t('Replay · {date} · daily board closed', {
        date: replay.periodKey ? formatChallengeDate(intl, replay.periodKey + 'T12:00:00Z', replay.timeZone ?? 'UTC') : '' }),
        backLabel: t('Back to challenge') },
    })
  }

  async function finishGame(attempt: NonNullable<typeof active>) {
    const target = attempt.pack && attempt.level.pack?.chapter
      ? chapterPath(attempt.pack, attempt.level.pack.chapter)
      : attempt.pack ? packPath(attempt.pack) : attempt.game.url
    setActive(undefined)
    if (attempt.from?.path === target) {
      back(target)
      return
    }
    replaceLayer(target)
    setPath(target)
    window.scrollTo(0, 0)
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
  /** Flush the pending attempt and post it before opening a leaderboard. */
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
  const dailySlot = challengeDay?.enabled
    ? challengeDay.slots.find(slot => slot.player.status === 'started') ??
      challengeDay.slots.find(slot => slot.player.status === 'available')
    : undefined
  const dailyGame = dailySlot ? games.find(game => game.id === dailySlot.game) : undefined
  const dailyCards: ContinueGame[] = dailySlot && dailyGame && challengeDay?.occurrence ? [{
    id: 'daily:' + dailySlot.id,
    title: dailyGame.title,
    details: t('Daily challenge · {date}', {
      date: formatChallengeDate(intl, challengeDay.occurrence.startsAt, challengeDay.occurrence.timezone) }),
    progress: dailySlot.player.status === 'started' ? t('In progress') : t('Ready'),
    preview: <span className="continue-daily-art"><CalendarDays size={24}/></span>,
    canResume: online,
    removable: false,
    daily: true,
  }] : []
  function continueRow(gameId?: string) {
    const cards = gameId ? continueCards.filter(card => card.game === gameId) : [...dailyCards, ...continueCards]
    return <ContinueGames games={cards}
      resume={id => {
        if (id.startsWith('daily:') && challengeDay && dailySlot) { perform(() => startChallenge(challengeDay, dailySlot)); return }
        perform(() => resume(id))
      }} remove={id => {
        if (id.startsWith('daily:')) return
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
  const inLeaderboards = path === '/leaderboards'
  const inStudioCatalog = path === '/studio' && canEdit
  const catalogCategories = ['All games', ...new Set(games.flatMap(game => game.tags)), 'Favorites']
  const catalogPage = (game: (typeof games)[number]) => inStudioCatalog ? '/studio/' + game.id : game.url
  const inNews = path === '/news'
  const inStudio = path === '/studio' || Boolean(studioGame) || inStudioRoute
  const studioOrigin = navigationLayer(history.state)?.studioOrigin
  const studioLeaveLabel = studioOrigin === 'game' && studioGame ? t('{game} menu', { game: studioGame.title }) : t('Studio')
  const inAdmin = path === '/admin'
  const inAbout = path === '/about'
  const challengeParts = path.split('/').filter(Boolean)
  const inChallenges = challengeParts[0] === 'challenges'
  const challengeOccurrence = inChallenges ? challengeParts[1] : undefined
  const challengeBoard = Boolean(inChallenges && challengeOccurrence && challengeParts.length === 3)
  const challengeGame = challengeBoard ? challengeParts[2] : undefined
  const playingNow = active && path === (active.playerPath ?? active.game.url) ? active : undefined
  const inGame = Boolean(openGame) || Boolean(playingNow)
  const inGameLeaderboards = Boolean(openGame && path.startsWith(openGame.url + '/leaderboards'))
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
  const playing = playingNow
  const inPackRoutes = Boolean(openGame?.packs && path.startsWith(openGame.url + '/packs/'))
  // Gameplay is the only immersive game mode. Pack browsing and selection use
  // the app shell so their navigation matches the game menu, history, guide,
  // and leaderboards.
  const immersive = Boolean(playing)
  const inShell = !immersive
  const playPack = playing?.pack
  const playLocation = playPack && playing?.level.pack ? packStopAt(playPack, playing.level.pack.stop) : undefined
  const playTheme = playLocation?.chapter.theme ?? (playPack ? packTheme(playPack) : undefined)
  const surface = immersive ? 'game' : inStudio ? 'studio' : 'library'
  const navLibrary = inLibrary || Boolean(inGame && !inGameLeaderboards && !inChallenges)
  const navChallenges = inChallenges
  const navLeaderboards = inLeaderboards || inGameLeaderboards
  const app = useRef<HTMLDivElement>(null)
  const gameSurface = useRef<HTMLElement>(null)
  const themeGame = openGame ?? playing?.game ?? studioGame
  const settings = (openGame ?? playing?.game)?.settings
  const viewedChapter = viewedPack && viewedChapterId
    ? viewedPack.data.chapters.find(chapter => chapter.id === viewedChapterId)
    : undefined
  const canExportViewedPack = Boolean(viewedPack && online && canEdit &&
    (account?.role === 'admin' || viewedPack.ownedByViewer))
  const packNavigation = inPackRoutes && openGame && viewedPack
    ? (label: string, leave: () => void) => <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17} aria-hidden="true"/>
        <span className="sr-only">{t('Back')} </span>{label}</button>
      <div className="game-nav-tools">
        {openGame.leaderboards && <a className="icon-button" href={openGame.url + '/leaderboards'}
          onClick={event => link(event, openGame.url + '/leaderboards')}
          aria-label={t('Leaderboard')} title={t('Leaderboard')}><Trophy size={18}/></a>}
        {openGame.history && <button className="icon-button" aria-label={t('History')} title={t('History')}
          onClick={() => go(openGame.url + '/history')}><History size={18}/></button>}
        {settings && <button className="icon-button" aria-label={t(settings.title)} title={t(settings.title)}
          onClick={() => showDialog('game')}><Settings2 size={18}/></button>}
        {canExportViewedPack && <a className="icon-button" href={packExportUrl(viewedPack)} download
          aria-label={t('Export pack')} title={t('Export pack')}><Download size={18}/></a>}
      </div>
    </div>
    : undefined
  const packHeading = inPackRoutes && openGame
    ? (title: string) => <GameHeading title={title} gameTitle={openGame.title}
      editor={canEdit && openGame.Studio ? { href: '/studio/' + openGame.id, open: event => openStudio(event, openGame.id) } : undefined}/>
    : undefined
  useLayoutEffect(() => setBrowserTheme(immersive ? gameSurface.current : app.current, immersive ? '--game-page' : '--surface'),
    [reader, surface, theme, themeGame?.id, playTheme])
  const bestMs = playing ? Math.min(...sessions.filter(item => item.id !== playing.session.id &&
    item.data.game === playing.game.id && item.data.level === playing.level.id &&
    item.data.levelRevision === playing.level.revision && item.data.completed).map(item => item.data.elapsedMs)) : Number.POSITIVE_INFINITY
  const bestScore = playing ? sessions.reduce((best, item) => {
    if (item.id === playing.session.id || item.data.game !== playing.game.id || !item.data.completed) return best
    const score = (item.data as { score?: unknown }).score
    return typeof score === 'number' && Number.isFinite(score) ? Math.max(best, score) : best
  }, 0) : 0

  return <div ref={app} className={'app' + (reader ? ' reader' : '') + (inShell ? ' app-shell' : '')} data-theme={theme} data-surface={surface}>
    {inShell && <>
      <header className="site-header"><div className="frame header-frame">
        <a className="brand" href="/" aria-label={t("Aviarium home")} onClick={event => link(event, '/')}><img src="/aviarium.svg" alt=""/>
          <span>Aviarium</span>
        </a>
        <div className="header-actions">
          {!online && <span className="offline-tag" aria-label={t("Offline")}><WifiOff size={16}/><span>{t("Offline")}</span></span>}
          <div className="header-account">
            <AccountMenu account={account} open={showDialog} about={() => go('/about')}
              administration={online && account?.role === 'admin' ? () => go('/admin') : undefined}/>
          </div>
        </div>
      </div></header>
      <div className="app-rail">
        <div className="rail-brand">
          <a className="brand" href="/" aria-label={t("Aviarium home")} onClick={event => link(event, '/')}><img src="/aviarium.svg" alt=""/>
            <span>Aviarium</span>
          </a>
        </div>
        <nav aria-label={t("Main navigation")} className="app-destinations">
          <a href="/" aria-current={navLibrary ? 'page' : undefined} onClick={event => link(event, '/')}><BookOpen size={21}/><span>{t("Library")}</span></a>
          {account && challengeSummary?.enabled === true && <a href="/challenges" aria-current={navChallenges ? 'page' : undefined}
            aria-label={challengeSummary?.open ? t('Challenges, {count} open', { count: challengeSummary.open }) : t('Challenges')}
            onClick={event => link(event, '/challenges')}><span className="nav-icon"><CalendarDays size={21}/>
              {Boolean(challengeSummary?.open) && <span className="nav-badge" aria-hidden="true">{challengeSummary!.open > 9 ? '9+' : challengeSummary!.open}</span>}</span>
            <span>{t('Challenges')}</span></a>}
          {account && <a href="/leaderboards" aria-current={navLeaderboards ? 'page' : undefined}
            onClick={event => link(event, '/leaderboards')}><Trophy size={21}/><span>{t("Leaderboards")}</span></a>}
          <a href="/news" aria-current={inNews ? 'page' : undefined} onClick={event => link(event, '/news')}><Newspaper size={21}/><span>{t("News")}</span></a>
        </nav>
        <div className="rail-account">
          {!online && <span className="offline-tag" aria-label={t("Offline")}><WifiOff size={16}/><span>{t("Offline")}</span></span>}
          <AccountMenu account={account} open={showDialog} about={() => go('/about')}
            administration={online && account?.role === 'admin' ? () => go('/admin') : undefined}/>
        </div>
      </div>
    </>}
    <main ref={gameSurface} className={(immersive ? 'game-frame' : inGame ? 'main-frame game-content' : 'frame main-frame') +
      (themeGame ? ' game-theme ' + themeGame.theme : '') + (studioGame ? ' studio-game-canvas' : '') +
      (playPack ? ` pack-palette pack-${playTheme}` : '')}>
      {notice && <div className="notice" role="alert">{knownMessage(t, notice)}<button onClick={() => setNotice('')}>{t("Dismiss")}</button></div>}
      {inLibrary && networkNotice && <p role="status" className="network-notice">{t("Sync delayed.")}{" "}{knownMessage(t, networkNotice)}</p>}
      {inLibrary && online && activate && <div className="notice">{t("An Aviarium update is ready.")}<button onClick={activate}>{t("Reload")}</button></div>}
      <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
      {inLibrary || inStudioCatalog ? <>
        {inLibrary && continueRow()}
        {inLibrary && <LibraryHero key={String(featureChallenges)} packs={packs} reader={reader} open={game => go(game.url)}
          openChallenges={featureChallenges ? () => go('/challenges') : undefined}/>}
        <GameCatalog studio={inStudioCatalog}
          action={inLibrary && canEdit && <a className="secondary studio-door" href="/studio"
            onClick={event => link(event, '/studio')}><Pencil size={16} aria-hidden="true"/> {t('Studio')}</a>}
          games={games.filter(game => (!inStudioCatalog || game.Studio) && (!reader || game.eReader)).map(game => ({
            ...game, description: t(inStudioCatalog ? game.studioDescription ?? game.description : game.description), href: catalogPage(game),
            artClass: game.theme, art: game.preview(game.sample?.(packs)),
            favorite: Boolean(game.favorite && prefs[game.favorite]),
            toggleFavorite: game.favorite ? () => changePrefs({ [game.favorite!]: !prefs[game.favorite!] }) : undefined,
            removeDownload: manageInstalls && installed.includes(game.id) ? () => perform(() => remove(game.id)) : undefined,
          }))} categories={catalogCategories} category={category} setCategory={setCategory} query={query} setQuery={setQuery} link={link}/>
      </>
      : inLeaderboards ? <LeaderboardCatalog games={games} sessions={sessions} accountId={account?.id} online={online} link={link}/>
      : playing ? <playing.game.Player key={playing.session.id} session={playing.session} level={playing.level} pack={playing.pack}
        preferences={prefs} reader={reader} bestMs={playing.challenge ? undefined : Number.isFinite(bestMs) ? bestMs : undefined}
        bestScore={playing.challenge ? undefined : bestScore || undefined}
        testMode={Boolean(account?.testRole)} persist={data => record(playing, data)}
        launch={playing.challenge || playing.replay ? undefined : level => perform(async () => {
          await saves.current.catch(() => undefined)
          try { await refreshLocal() } finally { await open(playing.game, level) }
        })}
        sync={() => saves.current.catch(() => undefined).then(() => sync(profile, mutationExtras))}
        challenge={playing.challenge ? { occurrenceId: playing.challenge.occurrenceId, slotId: playing.challenge.slotId,
          game: playing.challenge.game, attemptId: playing.challenge.attemptId, endsAt: playing.challenge.endsAt,
          rules: playing.challenge.rules } : undefined}
        standingsPanel={playing.challenge ? <ChallengeStandingsPanel occurrenceId={playing.challenge.occurrenceId}
          gameId={playing.challenge.game} accountId={account?.id} online={online}/> : undefined}
        replay={playing.replay}
        leaderboard={playing.challenge
          ? { open: () => viewLeaderboard('/challenges/' + playing.challenge!.occurrenceId + '/' + playing.challenge!.game) }
          : playing.game.leaderboards ? { open: () => viewLeaderboard(playing.game.leaderboards!.boardHref(playing.level)) } : undefined}
        openSettings={settings && !playing.challenge ? () => showDialog('game') : undefined}
        leave={() => perform(async () => {
          await saves.current.catch(() => undefined)
          try { await refreshLocal() }
          finally { back(playing.parent) }
        })}
        finish={playing.challenge || playing.replay ? undefined : () => perform(async () => {
          await saves.current.catch(() => undefined)
          try { await refreshLocal() }
          finally { await finishGame(playing) }
        })}
        reset={playing.challenge ? () => undefined : () => perform(async () => {
          await deleteAttempt(playing.head.id)
          await open(playing.game, playing.level, undefined, playing.pack, { replace: true })
        })}/>
      : inChallenges && challengeBoard ? <ChallengeBoard occurrenceId={challengeOccurrence!} gameId={challengeGame!}
        accountId={account?.id} online={online} back={() => back('/challenges/' + challengeOccurrence)}/>
      : inChallenges ? <ChallengesPage occurrenceId={challengeOccurrence} accountId={account?.id} online={online} link={link}
        start={(day, slot) => perform(() => startChallenge(day, slot))}
        replay={replay => perform(() => playReplay(replay))}
        openDay={occurrenceId => go('/challenges/' + occurrenceId)}
        openToday={() => go('/challenges')}/>
      : openGame?.leaderboards && path === openGame.url + '/leaderboards' ? <GameLeaderboards game={openGame}
        accountId={account?.id} online={online} link={link} back={() => back(openGame.url)}/>
      : openGame?.leaderboards && leaderboardBoardKey !== undefined ? <LeaderboardBoardView game={openGame}
        boardKey={leaderboardBoardKey} accountId={account?.id} online={online}
        back={() => back(openGame.url + '/leaderboards')} play={level => perform(() => open(openGame, level))}
        openGame={() => go(openGame.url)}/>
      : openGame?.leaderboards && leaderboardPack ? <LeaderboardPackView game={openGame} packId={leaderboardPack.id}
        revision={leaderboardPack.revision} accountId={account?.id} online={online}
        back={() => back(openGame.url + '/leaderboards')} link={link}/>
      : openGame?.guide && path === openGame.url + '/how-to' ? <GameGuide game={openGame.title} menuUrl={openGame.url}
        sections={openGame.guide} leave={event => backLink(event, openGame.url)}/>
      : openGame?.history && path === openGame.url + '/history' ? <GameHistory game={openGame} sessions={sessions} levels={savedLevels} packs={packs}
        leave={() => back(openGame.url)} replay={level => perform(() => open(openGame, level))} canPlay={canPlay(openGame)}/>
      : openGame?.packs && path === openGame.url + '/packs' ? <PackCatalog gameTitle={openGame.title}
        presentation={openGame.packs} packs={packs.filter(pack => pack.data.game === openGame.id)}
        completed={completed} sessions={sessions} status={packStatuses[openGame.id] ?? 'loading'}
        retry={() => setPackRetry(attempt => attempt + 1)} leave={() => back(openGame.url)}
        open={pack => go(packPath(pack))}/>
      : openGame?.packs && path.startsWith(openGame.url + '/packs/') ? viewedPack && viewedChapterId &&
          path === chapterPath(viewedPack, viewedChapterId)
        ? <PackRoadmap game={openGame.id} presentation={openGame.packs} pack={viewedPack} chapterId={viewedChapterId}
          completed={completed} sessions={sessions} canPlay={canPlay(openGame)}
          canExport={false}
          navigation={packNavigation?.(t('{pack} pack', { pack: openGame.packs.title(t, viewedPack) }),
            () => back(packPath(viewedPack)))}
          header={packHeading?.(viewedChapter
            ? t('{chapter} trail', { chapter: openGame.packs.chapterTitle(t, viewedPack, viewedChapter) })
            : t('Chapters'))}
          leave={() => back(packPath(viewedPack))} play={level => perform(() => {
            const existing = sessions.find(item => isResumable(item) && item.data.game === openGame.id &&
              item.data.level === level.id && item.data.levelRevision === level.revision)
            return existing ? resume(existing.id) : open(openGame, level, undefined, viewedPack)
          })}/>
        : viewedPack && path === packPath(viewedPack)
          ? <PackChapters presentation={openGame.packs} pack={viewedPack} completed={completed} sessions={sessions}
            canExport={false} navigation={packNavigation?.(t('Packs'), () => back(openGame.url))}
            header={packHeading?.(openGame.packs.title(t, viewedPack))}
            leave={() => back(openGame.url)} open={chapterId => go(chapterPath(viewedPack, chapterId))}/>
          : <section className="catalog"><button className="text-button" onClick={() => back(openGame.url)}>{t(openGame.packs.menuLabel)}</button>
            <p role={packProblem ? 'alert' : 'status'}>{(packProblem && knownMessage(t, packProblem)) || t('Loading pack…')}</p></section>
      : openGame && path === openGame.url ? (() => {
        const menuItems: GameMenuItem[] = []
        if (openGame.packs) menuItems.push({ key: 'packs', label: t('Packs'),
          icon: <Package size={24}/>, href: openGame.url + '/packs',
          open: event => link(event, openGame.url + '/packs') })
        if (openGame.leaderboards) menuItems.push({ key: 'leaderboards', label: t('Leaderboards'),
          icon: <Trophy size={24}/>, href: openGame.url + '/leaderboards',
          open: event => link(event, openGame.url + '/leaderboards') })
        if (openGame.history) menuItems.push({ key: 'history', label: t('History'),
          icon: <History size={24}/>, href: openGame.url + '/history',
          open: event => link(event, openGame.url + '/history') })
        if (openGame.guide) menuItems.push({ key: 'guide', label: t('How to play'),
          icon: <CircleHelp size={24}/>, href: openGame.url + '/how-to',
          open: event => link(event, openGame.url + '/how-to') })
        return <GameMenu title={openGame.title} gameId={openGame.id} mascot={openGame.mascot} leave={() => back('/')}>
          {continueRow(openGame.id)}
          {!canPlay(openGame) && <p className="notice">{t(openGame.connectMessage)}</p>}
          {openGame.menu?.({ canPlay: canPlay(openGame), online, profile, preferences: prefs,
            updatePreferences: changePrefs, params: new URLSearchParams(location.search),
            launch: (level, launchOptions) => open(openGame, level, undefined, undefined,
              { playOptions: launchOptions?.playOptions }), perform })}
          <GameMenuLinks items={menuItems} label={t('{game} menu', { game: openGame.title })}/>
        </GameMenu>
      })()
      : inNews ? <News account={account} online={online}/>
      : inAbout ? <section className="panel about-page" aria-labelledby="about-heading">
        <h1 id="about-heading">{t("About Aviarium")}</h1>
        <p>{t('Version {version}', { version: import.meta.env.VITE_AVIARIUM_VERSION })}</p>
        <p>{t('Aviarium is a self-hosted puzzle library. Start with Sudoku, play the same published puzzles as everyone else, and pick up where you left off. You can download games to play offline, and creators can use Studio to build and share their own puzzles.')}</p>
        <p>{t('2048 is based on the original game by Gabriele Cirulli, released under the MIT license.')} <a href="https://github.com/gabrielecirulli/2048">{t('Original 2048')}</a></p>
        <a className="secondary" href="https://github.com/Trustadz/aviarium">{t("Aviarium on GitHub")}</a>
      </section>
      : studioGame?.Studio && account && canEdit && (!adminPackStudio || (online && account.role === 'admin')) ? <>
        <studioGame.Studio key={account.id + ':' + studioGame.id + (adminPackStudio ? ':admin' : '')} account={account} online={online}
          admin={adminPackStudio} reader={reader} theme={theme} packs={packs.filter(pack => pack.data.game === studioGame.id)}
          leaveLabel={studioLeaveLabel}
          leave={() => back(adminPackStudio ? '/admin' : '/studio')} onPublish={() => perform(() => refreshPacks())}/>
      </>
      : studioGame && canEdit ? <section className="panel"><h1>{t('Access required')}</h1>
        <a className="secondary" href="/studio" onClick={event => link(event, '/studio')}>{t('Studio')}</a></section>
      : inStudioRoute ? <section className="panel"><h1>{t('Studio')}</h1>
        <p>{t('This game has no Studio editor.')}</p>
        <a className="secondary" href="/studio" onClick={event => link(event, '/studio')}>{t('Studio')}</a></section>
      : inAdmin && online && account?.role === 'admin' ? <>
        <Admin key={account.id} account={account} openPackStudio={game => go('/studio/' + game + '/admin')}/>
      </>
      : <section className="panel"><h1>{t("Access required")}</h1><p>{t("Sign in with an authorized account.")}</p><button className="secondary" onClick={() => go('/')}>{t("Return to library")}</button></section>}
      </Suspense>
    </main>
    {activeRemoval && <LeaderboardNotice notice={activeRemoval} onAcknowledge={acknowledgeRemoval}/>}
    {dialog && <div className="settings-overlay" onClick={() => showDialog(undefined)}>
      <section className={'settings-panel' + (dialog === 'game' && openGame ? ' game-theme ' + openGame.theme +
        (playPack ? ` pack-palette pack-${playTheme}` : '') : '')}
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
