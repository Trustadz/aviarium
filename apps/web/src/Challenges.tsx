import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Clock3, Play, RotateCcw, Trophy } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { formatLeaderboardValue } from '../../../packages/game-sdk/src/leaderboards.js'
import { api, errorMessage } from './api.js'
import { Avatar } from './Avatar.js'
import { resultGroups, resultRows } from './standings.js'
import { findGame } from './registry.js'
import { knownMessage, useT } from './i18n.js'
import type { Message } from './messages.js'

export interface ChallengeReplayView {
  game: string
  occurrenceId?: string
  periodKey?: string
  timeZone?: string
  seed: string
  options: Record<string, string | number | boolean | null>
  rules: Record<string, string | number | boolean | null>
  generatorVersion: number
}

export interface ChallengeSlotView {
  id: string
  game: string
  position: number
  status: 'pending' | 'ready' | 'failed'
  options: Record<string, string | number | boolean | null>
  rules: Record<string, string | number | boolean | null>
  level?: GameLevel & { grid?: string | null; content?: unknown; difficulty?: string | null }
  player: {
    status: 'available' | 'started' | 'completed' | 'closed' | 'expired' | 'missed' | 'unavailable'
    attemptId?: string
    sessionId?: string
    startedAt?: string
    result?: { id: string; status: 'active' | 'removed'; rank: number | null; total: number; value: number; unit: 'ms' } | null
  }
  standings: { top: LeaderboardStanding[]; you: LeaderboardStanding | null; total: number }
  replay?: ChallengeReplayView
  failureCode?: string | null
}

export interface ChallengeDayView {
  enabled: boolean
  slots: ChallengeSlotView[]
  open: number
  serverNow: string
  occurrence: null | {
    id: string; periodKey: string; startsAt: string; endsAt: string; timezone: string
    prepared: boolean; preparing: boolean; failureCode?: string | null
  }
  series: null | { timezone: string; resetMinute: number; gameLimit: number; gameOptions: Record<string, Record<string, string[]>> }
  nextStart?: string | null
}

export interface ChallengeBoardViewData {
  board: {
    game: string; key: string; kind: 'challenge'; difficulty?: string; levelTitle?: string
    challenge?: { occurrenceId: string; periodKey: string; slotId: string; timeZone: string; closed?: boolean }
  }
  slot: { id: string; game: string; options: Record<string, string | number | boolean | null>; rules: Record<string, string | number | boolean | null>; playerStatus: string }
  top: LeaderboardStanding[]
  you: LeaderboardStanding | null
  total: number
  serverNow: string
  replay?: ChallengeReplayView
}

type Link = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void

const dayPath = (occurrenceId: string) => '/challenges/' + occurrenceId
const boardPath = (occurrenceId: string, game: string) => '/challenges/' + occurrenceId + '/' + game

export function formatChallengeTime(t: ReturnType<typeof useT>, intl: ReturnType<typeof useIntl>, iso: string, timeZone: string) {
  return intl.formatTime(new Date(iso), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
}

export function formatChallengeDate(intl: ReturnType<typeof useIntl>, iso: string, timeZone: string) {
  return intl.formatDate(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short', timeZone })
}

export function formatResetMinute(resetMinute: number) {
  return String(Math.floor(resetMinute / 60)).padStart(2, '0') + ':' + String(resetMinute % 60).padStart(2, '0')
}

function remainingText(endsAt: string, now: number, t: ReturnType<typeof useT>) {
  const remaining = Math.max(0, Date.parse(endsAt) - now)
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes <= 0) return t('Closed')
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? t('{hours}h {minutes}m left', { hours, minutes: minutes % 60 }) : t('{minutes}m left', { minutes })
}

function statusLabel(t: ReturnType<typeof useT>, slot: ChallengeSlotView, past: boolean) {
  if (slot.status === 'failed') return t('Unavailable')
  if (slot.status !== 'ready') return t('Preparing challenge')
  switch (slot.player.status) {
    case 'available': return past ? t('Not played') : t('Ready')
    case 'started': return past ? t('Not completed') : t('In progress')
    case 'completed': return t('Completed')
    case 'closed': return t('Closed')
    case 'expired': return t('Not completed')
    case 'missed': return t('Not played')
    default: return t('Unavailable')
  }
}

function MiniTop({ rows, total, href, link }: { rows: LeaderboardStanding[]; total: number; href?: string; link: Link }) {
  const t = useT()
  if (!rows.length) return <p className="muted challenge-empty">{t('No posted times yet.')}</p>
  const visible = rows.slice(0, 3)
  return <ol className="challenge-mini">
    {visible.map(row => <li key={row.rank + ':' + row.name} data-you={row.you || undefined}>
      <span className="challenge-rank">{row.rank}</span>
      <Avatar name={row.name} url={row.avatarUrl}/>
      <span className="challenge-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
      <strong>{formatLeaderboardValue(row.value, row.unit)}</strong>
    </li>)}
    {total > visible.length && href && <li className="challenge-mini-more">
      <a href={href} onClick={event => link(event, href)}>{t('and {count} more', { count: total - visible.length })}</a>
    </li>}
  </ol>
}

function SlotCard({ day, slot, past, start, replay, link }: {
  day: ChallengeDayView; slot: ChallengeSlotView; past: boolean
  start: () => void; replay: (replay: ChallengeReplayView) => void; link: Link
}) {
  const t = useT()
  const game = findGame(slot.game)
  const title = game ? knownMessage(t, game.title) : slot.game
  const size = typeof slot.options.size === 'number' ? slot.options.size : undefined
  const detail = [size ? size + ' × ' + size : '', slot.level?.difficulty ? t(slot.level.difficulty as Message) : ''].filter(Boolean).join(' · ')
  const result = slot.player.result
  const [starting, setStarting] = useState(false)
  const begin = async () => {
    if (starting) return
    setStarting(true)
    try { await start() } finally { setStarting(false) }
  }
  const boardHref = '/challenges/' + day.occurrence!.id + '/' + slot.game
  return <section className="challenge-slot panel challenge-row" aria-label={title}>
    <div className="challenge-row-body">
      <div className="challenge-slot-head">
        <div>
          <p className="eyebrow">{past ? t('Daily challenge · closed') : t('Daily challenge')}</p>
          <h2>{title}</h2>
          {detail && <p className="challenge-detail">{detail}</p>}
        </div>
        <span className={'badge challenge-status status-' + slot.player.status}>{statusLabel(t, slot, past)}</span>
      </div>
      {slot.player.status === 'completed' && result && <p className="challenge-result">
        <Trophy size={15}/> {formatLeaderboardValue(result.value, result.unit)}
        {result.rank ? <span> · #{result.rank} / {result.total}</span> : null}
      </p>}
      <MiniTop rows={slot.standings.top} total={slot.standings.total} href={boardHref} link={link}/>
      <div className="challenge-actions">
        {!past && slot.player.status === 'available' && <button className="primary" onClick={begin} disabled={starting}
          aria-label={t('Start {game} challenge', { game: title })}><Play size={16}/> {starting ? t('Starting…') : t('Start challenge')}</button>}
        {!past && slot.player.status === 'started' && <button className="primary" onClick={begin} disabled={starting}
          aria-label={t('Resume {game} challenge', { game: title })}><Play size={16}/> {starting ? t('Starting…') : t('Resume challenge')}</button>}
        {past && slot.replay && <button className="secondary" onClick={() => replay({ ...slot.replay!,
          occurrenceId: day.occurrence?.id, periodKey: day.occurrence?.periodKey, timeZone: day.occurrence?.timezone })}>
          <RotateCcw size={16}/> {t('Play this game')}</button>}
      </div>
      {slot.status === 'failed' && <p className="error" role="alert">{t('This challenge game is unavailable. Try again later.')}</p>}
    </div>
    <div className={'challenge-preview' + (game ? ' ' + game.theme : '')}>{game?.preview && slot.level ? game.preview(slot.level) : null}</div>
  </section>
}

function ChallengeParrot() {
  return <svg className="challenge-parrot" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path fill="var(--accent-strong)" d="M27 18c-2-5-6-9-11-10 2 5 5 8 9 11ZM34 16c0-6 3-10 8-12-1 6-3 10-6 13Z"/>
    <circle cx="32" cy="33" r="16" fill="var(--accent)"/>
    <circle cx="40" cy="35" r="10" fill="#f7f2e7"/>
    <circle cx="43" cy="31" r="2.2" fill="var(--text)"/>
    <circle cx="43.7" cy="30.3" r=".7" fill="#fff"/>
    <path fill="#d99a32" d="M48 33c5 1 8 4 8 7s-4 5-8 3l-1-5Z"/>
    <path fill="var(--accent-strong)" d="M20 40c-3 7-2 13 2 17 4-2 7-7 7-13Z"/>
    <path fill="var(--tint)" d="M22 28c5 0 9 4 10 9-5 2-9-2-10-9Z"/>
  </svg>
}

export function ChallengesPage({ occurrenceId, accountId, online, link, start, replay, openDay, openToday }: {
  occurrenceId?: string; accountId?: string; online: boolean; link: Link
  start: (day: ChallengeDayView, slot: ChallengeSlotView) => void
  replay: (replay: ChallengeReplayView) => void
  openDay: (occurrenceId: string) => void
  openToday: () => void
}) {
  const t = useT()
  const intl = useIntl()
  const [day, setDay] = useState<ChallengeDayView>()
  const [problem, setProblem] = useState('')
  const [loading, setLoading] = useState(false)
  const [previous, setPrevious] = useState<{ id: string; periodKey: string; startsAt: string; timezone: string }>()
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [reload, setReload] = useState(0)
  const [, setTick] = useState(0)
  useEffect(() => { setDay(undefined); setProblem('') }, [occurrenceId, accountId])
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!online) { setDay(undefined); return }
    let current = true
    setLoading(true); setProblem('')
    const path = occurrenceId ? '/challenges/' + encodeURIComponent(occurrenceId) : '/challenges'
    void api<ChallengeDayView>(path, undefined, accountId).then(value => {
      if (current) { setDay(value); setFetchedAt(Date.now()); setLoading(false) }
    }, error => {
      if (current) { setProblem(errorMessage(error)); setLoading(false) }
    })
    return () => { current = false }
  }, [accountId, occurrenceId, online, reload])
  useEffect(() => {
    if (!day?.occurrence) return
    const anchor = Date.parse(day.serverNow) + (Date.now() - fetchedAt)
    const end = Date.parse(day.occurrence.endsAt)
    if (anchor >= end) return
    const timer = setTimeout(() => setReload(value => value + 1),
      Math.max(0, Math.min(end - anchor + 1000, 2_147_000_000)))
    const visible = () => { if (document.visibilityState === 'visible') setReload(value => value + 1) }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [day?.occurrence?.id, day?.occurrence?.endsAt, fetchedAt])
  useEffect(() => {
    if (occurrenceId || !online) { setPrevious(undefined); return }
    let current = true
    void api<{ occurrences: { occurrence: { id: string; periodKey: string; startsAt: string; timezone: string } }[] }>(
      '/challenges/history?limit=1', undefined, accountId).then(value => {
      if (current) setPrevious(value.occurrences[0]?.occurrence)
    }, () => { if (current) setPrevious(undefined) })
    return () => { current = false }
  }, [accountId, occurrenceId, online])
  const liveNow = day?.serverNow ? Date.parse(day.serverNow) + (Date.now() - fetchedAt) : Date.now()
  const past = Boolean(day?.occurrence && liveNow >= Date.parse(day.occurrence.endsAt))
  const date = day?.occurrence ? formatChallengeDate(intl, day.occurrence.startsAt, day.occurrence.timezone) : ''
  const canPlay = day?.enabled && day.occurrence && !past
  const completedSlots = day?.slots.filter(slot => slot.player.status === 'completed').length ?? 0
  const openSlots = day?.slots.filter(slot => slot.player.status !== 'completed') ?? []
  const finishedSlots = day?.slots.filter(slot => slot.player.status === 'completed') ?? []
  return <section className="catalog challenges-page">
    {occurrenceId && <div className="game-navigation"><button className="text-button back" onClick={openToday}>
      <ArrowLeft size={17}/> {t('Challenges')}</button></div>}
    <div className="section-heading">
      <div>
        {past && <p className="eyebrow">{t('Closed challenge')}</p>}
        <h1>{occurrenceId ? t('Daily challenge · {date}', { date }) : t('Challenges')}</h1>
      </div>
    </div>
    {!online && <p className="notice">{t('Connect to view daily challenges.')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {loading && !day && <p role="status">{t('Loading…')}</p>}
    {day && !day.enabled && <div className="panel padded challenge-empty-state"><CalendarDays size={26}/><h2>{t('Daily challenges are not enabled on this instance.')}</h2></div>}
    {day && day.enabled && !day.occurrence && <div className="panel padded challenge-empty-state"><CalendarDays size={26}/>
      <h2>{t('Preparing today’s challenge')}</h2>
      {day.nextStart && <p>{t('Starts at {time} ({zone})', { time: formatChallengeTime(t, intl, day.nextStart, day.series?.timezone ?? 'UTC'), zone: day.series?.timezone ?? 'UTC' })}</p>}
    </div>}
    {day?.occurrence && <>
      <div className="challenge-meta panel">
        <span><strong>{date}</strong></span>
        {!past && Boolean(day.slots.length) && <span>{t('{done} of {total} completed', { done: completedSlots, total: day.slots.length })}</span>}
        <span className="challenge-clock"><Clock3 size={16}/> {past
          ? t('Closed at {time} ({zone})', { time: formatChallengeTime(t, intl, day.occurrence.endsAt, day.occurrence.timezone), zone: day.occurrence.timezone })
          : remainingText(day.occurrence.endsAt, liveNow, t)}</span>
        {past && <span>{t('The daily leaderboard is closed. Play the seed as a normal game.')}</span>}
      </div>
      {!past && day.slots.length > 0 && finishedSlots.length === day.slots.length && <div className="challenge-all-done" role="status">
        <ChallengeParrot/>
        <div><h2>{t('All challenges completed!')}</h2><p>{t('Come back after the next reset for a new set.')}</p></div>
      </div>}
      <div className="challenge-slots">
        {openSlots.map(slot => <SlotCard key={slot.id} day={day} slot={slot} past={Boolean(past)}
          link={link} start={() => start(day, slot)} replay={replay}/>)}
      </div>
      {!day.slots.length && <p className="empty">{t('Today’s challenge is being prepared. Try again in a moment.')}</p>}
      {finishedSlots.length > 0 && <section className="challenge-completed">
        <div className="section-heading"><h2>{t('Completed')}</h2></div>
        <div className="challenge-slots">
          {finishedSlots.map(slot => <SlotCard key={slot.id} day={day} slot={slot} past={Boolean(past)}
            link={link} start={() => start(day, slot)} replay={replay}/>)}
        </div>
      </section>}
    </>}
    {!occurrenceId && previous && <button className="text-button challenge-yesterday" onClick={() => openDay(previous.id)}>
      {t('Yesterday')} · {formatChallengeDate(intl, previous.startsAt, previous.timezone)}
    </button>}
  </section>
}

export function ChallengeBoard({ occurrenceId, gameId, accountId, online, back }: {
  occurrenceId: string; gameId: string; accountId?: string; online: boolean; back: () => void
}) {
  const t = useT()
  const intl = useIntl()
  const [data, setData] = useState<ChallengeBoardViewData>()
  const [problem, setProblem] = useState('')
  useEffect(() => {
    if (!online) { setData(undefined); return }
    let current = true
    setProblem('')
    setData(undefined)
    void api<ChallengeBoardViewData>('/challenges/' + encodeURIComponent(occurrenceId) + '/slots/' + encodeURIComponent(gameId) + '/board',
      undefined, accountId).then(value => { if (current) setData(value) },
    error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId, gameId, occurrenceId, online])
  const game = findGame(gameId)
  const title = game ? knownMessage(t, game.title) : gameId
  const period = data?.board.challenge?.periodKey
  const date = period ? formatChallengeDate(intl, period + 'T12:00:00Z', data?.board.challenge?.timeZone ?? 'UTC') : ''
  const rows = useMemo(() => {
    if (!data) return []
    const rows = [...data.top]
    if (data.you && !rows.some(row => row.you)) rows.push(data.you)
    return rows
  }, [data])
  return <section className="catalog challenge-board">
    <div className="game-navigation"><button className="text-button back" onClick={back}><ArrowLeft size={17}/> {t('Back')}</button></div>
    <div className="section-heading"><div><p className="eyebrow">{t('Daily challenge')}</p><h1>{date} · {title}</h1></div>
      <span className="badge">{t('{count, plural, one {# player} other {# players}}', { count: data?.total ?? 0 })}</span></div>
    {!online && <p className="notice">{t('Connect to view leaderboards.')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {!data && !problem && online && <p role="status">{t('Loading…')}</p>}
    {data && (rows.length ? <div className="leaderboard-table-wrap"><table className="leaderboard-table">
      <caption className="visually-hidden">{t('Standings for {board}', { board: date + ' · ' + title })}</caption>
      <thead><tr><th scope="col">{t('Rank')}</th><th scope="col">{t('Player')}</th><th scope="col">{t('Time')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.rank + ':' + row.name} data-you={row.you || undefined}>
        <td className="leaderboard-rank"><span className="leaderboard-rank-value">{row.rank}</span></td>
        <td className="leaderboard-player-cell"><div className="leaderboard-player-inner"><Avatar name={row.name} url={row.avatarUrl}/><span className="leaderboard-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span></div></td>
        <td className="leaderboard-time">{formatLeaderboardValue(row.value, row.unit)}</td>
      </tr>)}</tbody>
    </table></div> : <div className="empty challenge-empty-state"><Trophy size={28}/><h2>{t('No posted times yet.')}</h2></div>)}
    {data?.board.challenge?.closed && <p className="muted challenge-foot">{t('This daily leaderboard is closed.')}</p>}
  </section>
}

export function ChallengeStandingsPanel({ occurrenceId, gameId, accountId, online }: {
  occurrenceId: string; gameId: string; accountId?: string; online: boolean
}) {
  const t = useT()
  const [data, setData] = useState<ChallengeBoardViewData>()
  const [problem, setProblem] = useState('')
  const [attempts, setAttempts] = useState(0)
  useEffect(() => {
    if (!online) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number) => {
      void api<ChallengeBoardViewData>('/challenges/' + encodeURIComponent(occurrenceId) + '/slots/' + encodeURIComponent(gameId) + '/board',
        undefined, accountId).then(value => {
        if (!current) return
        setData(value)
        if (!value.you && attempt < 4) timer = setTimeout(() => load(attempt + 1), 900 * (attempt + 1))
        else setAttempts(attempt)
      }, error => { if (current) { setProblem(errorMessage(error)); setAttempts(commentAttempt(attempt)) } })
    }
    load(0)
    return () => { current = false; if (timer) clearTimeout(timer) }
  }, [accountId, gameId, occurrenceId, online])
  if (!online) return <p className="challenge-panel-note">{t('Standings will appear when you’re online.')}</p>
  if (problem) return <p className="challenge-panel-note" role="alert">{t('Standings unavailable.')}</p>
  if (!data) return <p className="challenge-panel-note" role="status">{t('Posting your result…')}</p>
  const rows = resultRows(data.top, data.you, data.total)
  const groups = resultGroups(data.top, data.you, data.total)
  return <section className="challenge-panel" aria-label={t('Challenge standings')}>
    <div className="challenge-panel-head"><span className="eyebrow">{t('Challenge standings')}</span><span className="muted">{t('{count, plural, one {# player} other {# players}}', { count: data.total })}</span></div>
    <ol className="challenge-mini">{groups.map((group, index) => <Fragment key={index}>
      {index > 0 && <li className="challenge-gap" aria-hidden="true">…</li>}
      {group.map(row => <li key={row.rank + ':' + row.name} data-you={row.you || undefined}>
        <span className="challenge-rank">{row.rank}</span><Avatar name={row.name} url={row.avatarUrl}/><span className="challenge-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
        <strong>{formatLeaderboardValue(row.value, row.unit)}</strong>
      </li>)}
    </Fragment>)}</ol>
    {!rows.length && <p className="challenge-panel-note">
      {data.you ? t('You’re first — no other times yet.')
        : attempts < 4 ? t('Syncing your result…') : t('No posted times yet.')}</p>}
    {!data.you && attempts < 4 && <p className="challenge-panel-note" role="status">{t('Syncing your result…')}</p>}
    {!data.you && attempts >= 4 && <p className="challenge-panel-note">{t('This run did not post to the leaderboard.')}</p>}
  </section>
}

function commentAttempt(attempt: number) { return attempt + 1 }
