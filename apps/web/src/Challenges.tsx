import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Play, RotateCcw, Trophy } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { formatLeaderboardValue } from '../../../packages/game-sdk/src/leaderboards.js'
import { api, errorMessage } from './api.js'
import { Avatar } from './Avatar.js'
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

function remainingText(endsAt: string, serverNow: string, tick: number, t: ReturnType<typeof useT>) {
  const offset = Date.parse(serverNow) - Date.now()
  const remaining = Math.max(0, Date.parse(endsAt) - (Date.now() + offset) + tick * 0)
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

function MiniTop({ rows, total }: { rows: LeaderboardStanding[]; total: number }) {
  const t = useT()
  if (!rows.length) return <p className="muted challenge-empty">{t('No posted times yet.')}</p>
  return <ol className="challenge-mini">
    {rows.slice(0, 3).map(row => <li key={row.rank + ':' + row.name} data-you={row.you || undefined}>
      <span className="challenge-rank">{row.rank}</span>
      <Avatar name={row.name} url={row.avatarUrl}/>
      <span className="challenge-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
      <strong>{formatLeaderboardValue(row.value, row.unit)}</strong>
    </li>)}
    {total > rows.length && <li className="challenge-mini-more"><span>{t('and {count} more', { count: total - rows.length })}</span></li>}
  </ol>
}

function SlotCard({ day, slot, past, accountId, link, start, board, replay }: {
  day: ChallengeDayView; slot: ChallengeSlotView; past: boolean; accountId?: string
  link: Link; start: () => void; board: () => void; replay: (replay: ChallengeReplayView) => void
}) {
  const t = useT()
  const intl = useIntl()
  const game = findGame(slot.game)
  const title = game ? knownMessage(t, game.title) : slot.game
  const size = typeof slot.options.size === 'number' ? slot.options.size : undefined
  const detail = [size ? size + ' × ' + size : '', slot.level?.difficulty ? t(slot.level.difficulty as Message) : ''].filter(Boolean).join(' · ')
  const result = slot.player.result
  const [starting, setStarting] = useState(false)
  const miniRows = [...slot.standings.top]
  if (slot.standings.you && !miniRows.some(row => row.you)) miniRows.push(slot.standings.you)
  const begin = async () => {
    if (starting) return
    if (slot.player.status === 'available' && !window.confirm(t('Start the one timed run? The clock begins immediately.'))) return
    setStarting(true)
    try { await start() } finally { setStarting(false) }
  }
  return <section className="challenge-slot panel" aria-label={title}>
    <div className="challenge-slot-head">
      <div>
        <p className="eyebrow">{past ? t('Daily challenge · closed') : t('Daily challenge')}</p>
        <h2>{title}{detail ? ' · ' + detail : ''}</h2>
      </div>
      <span className={'badge challenge-status status-' + slot.player.status}>{statusLabel(t, slot, past)}</span>
    </div>
    {game?.preview && slot.level && <div className="challenge-preview">{game.preview(slot.level)}</div>}
    {slot.player.status === 'completed' && result && <p className="challenge-result">
      <Trophy size={16}/> {formatLeaderboardValue(result.value, result.unit)}
      {result.rank ? <span> · #{result.rank} / {result.total}</span> : null}
    </p>}
    <MiniTop rows={miniRows} total={slot.standings.total}/>
    <div className="challenge-actions">
      {!past && (slot.player.status === 'available') && <button className="primary" onClick={begin} disabled={starting}
        aria-label={t('Start {game} challenge', { game: title })}><Play size={17}/> {starting ? t('Starting…') : t('Start challenge')}</button>}
      {!past && slot.player.status === 'started' && <button className="primary" onClick={begin} disabled={starting}
        aria-label={t('Resume {game} challenge', { game: title })}><Play size={17}/> {starting ? t('Starting…') : t('Resume challenge')}</button>}
      {!past && slot.player.status === 'available' && <p className="muted challenge-start-note">{t('One timed run. The clock starts when you begin.')}</p>}
      {slot.player.status === 'completed' && <button className="secondary" onClick={board}
        aria-label={t('View {game} challenge board', { game: title })}>{t('View board')}</button>}
      {past && slot.replay && <button className="secondary" onClick={() => replay({ ...slot.replay!,
        occurrenceId: day.occurrence?.id, periodKey: day.occurrence?.periodKey, timeZone: day.occurrence?.timezone })}>
        <RotateCcw size={16}/> {t('Play this seed')}</button>}
      {slot.status !== 'failed' && slot.player.status !== 'completed' && <button className="text-button" onClick={board}
        aria-label={t('View {game} challenge board', { game: title })}>{t('Challenge board')} <ChevronRight size={16}/></button>}
    </div>
    {slot.status === 'failed' && <p className="error" role="alert">{t('This challenge game is unavailable. Try again later.')}</p>}
  </section>
}

export function ChallengesPage({ occurrenceId, accountId, online, link, start, replay, board, openDay, openToday }: {
  occurrenceId?: string; accountId?: string; online: boolean; link: Link
  start: (day: ChallengeDayView, slot: ChallengeSlotView) => void
  replay: (replay: ChallengeReplayView) => void
  board: (occurrenceId: string, game: string) => void
  openDay: (occurrenceId: string) => void
  openToday: () => void
}) {
  const t = useT()
  const intl = useIntl()
  const [day, setDay] = useState<ChallengeDayView>()
  const [problem, setProblem] = useState('')
  const [loading, setLoading] = useState(false)
  const [previous, setPrevious] = useState<{ id: string; periodKey: string; startsAt: string; timezone: string }>()
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
      if (current) { setDay(value); setLoading(false) }
    }, error => {
      if (current) { setProblem(errorMessage(error)); setLoading(false) }
    })
    return () => { current = false }
  }, [accountId, occurrenceId, online])
  useEffect(() => {
    if (occurrenceId || !online) { setPrevious(undefined); return }
    let current = true
    void api<{ occurrences: { occurrence: { id: string; periodKey: string; startsAt: string; timezone: string } }[] }>(
      '/challenges/history?limit=1', undefined, accountId).then(value => {
      if (current) setPrevious(value.occurrences[0]?.occurrence)
    }, () => { if (current) setPrevious(undefined) })
    return () => { current = false }
  }, [accountId, occurrenceId, online])
  const past = Boolean(day?.occurrence && day.serverNow &&
    Date.parse(day.serverNow) >= Date.parse(day.occurrence.endsAt))
  const date = day?.occurrence ? formatChallengeDate(intl, day.occurrence.startsAt, day.occurrence.timezone) : ''
  const reset = day?.occurrence ? formatResetMinute(day.series?.resetMinute ?? 0) : ''
  const canPlay = day?.enabled && day.occurrence && !past
  const completedSlots = day?.slots.filter(slot => slot.player.status === 'completed').length ?? 0
  return <section className="catalog challenges-page">
    {occurrenceId && <div className="game-navigation"><button className="text-button back" onClick={openToday}>
      <ArrowLeft size={17}/> {t('Daily Challenges')}</button></div>}
    <div className="section-heading">
      <div>
        <p className="eyebrow">{past ? t('Closed challenge') : t('A new puzzle every day')}</p>
        <h1>{occurrenceId ? t('Daily challenge · {date}', { date }) : t('Daily Challenges')}</h1>
      </div>
      {day?.occurrence && <span className="challenge-clock"><Clock3 size={18}/> {past ? t('Closed') : remainingText(day.occurrence.endsAt, day.serverNow, 0, t)}</span>}
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
        {Boolean(day.slots.length) && <span>{t('{done} of {total} completed', { done: completedSlots, total: day.slots.length })}</span>}
        <span>{past
          ? t('Closed at {time} ({zone})', { time: formatChallengeTime(t, intl, day.occurrence.endsAt, day.occurrence.timezone), zone: day.occurrence.timezone })
          : t('Resets at {time} ({zone})', { time: reset, zone: day.occurrence.timezone })}</span>
        {past && <span>{t('The daily leaderboard is closed. Play the seed as a normal game.')}</span>}
      </div>
      <div className="challenge-slots">
        {day.slots.map(slot => <SlotCard key={slot.id} day={day} slot={slot} past={Boolean(past)} accountId={accountId}
          link={link} start={() => start(day, slot)}
          board={() => board(day.occurrence!.id, slot.game)}
          replay={replay}/>)}
      </div>
      {!day.slots.length && <p className="empty">{t('Today’s challenge is being prepared. Try again in a moment.')}</p>}
    </>}
    {!occurrenceId && previous && <button className="text-button challenge-yesterday" onClick={() => openDay(previous.id)}>
      {t('Yesterday')} · {formatChallengeDate(intl, previous.startsAt, previous.timezone)}
    </button>}
    {!occurrenceId && <p className="muted challenge-foot">{t('One attempt per game. Resetting the board does not reset the timer.')}</p>}
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
    <p className="muted challenge-foot">{data?.board.challenge?.closed
      ? t('This daily leaderboard is closed.')
      : t('The daily leaderboard closes when the next challenge starts.')}</p>
  </section>
}

export function ChallengeStandingsPanel({ occurrenceId, gameId, accountId, online, onPlayOther }: {
  occurrenceId: string; gameId: string; accountId?: string; online: boolean; onPlayOther?: (game: string) => void
}) {
  const t = useT()
  const [data, setData] = useState<ChallengeBoardViewData>()
  const [problem, setProblem] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [other, setOther] = useState<ChallengeSlotView>()
  useEffect(() => {
    if (!online) return
    let current = true
    void api<ChallengeDayView>('/challenges', undefined, accountId).then(value => {
      if (!current) return
      setOther(value.slots.find(slot => slot.game !== gameId &&
        (slot.player.status === 'available' || slot.player.status === 'started')))
    }, () => undefined)
    return () => { current = false }
  }, [accountId, gameId, online])
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
  const rows = data.top.slice(0, 3)
  if (data.you && !rows.some(row => row.you)) rows.push(data.you)
  return <section className="challenge-panel" aria-label={t('Challenge standings')}>
    <div className="challenge-panel-head"><span className="eyebrow">{t('Challenge standings')}</span><span className="muted">{t('{count, plural, one {# player} other {# players}}', { count: data.total })}</span></div>
    <ol className="challenge-mini">{rows.slice(0, 4).map(row => <li key={row.rank + ':' + row.name} data-you={row.you || undefined}>
      <span className="challenge-rank">{row.rank}</span><Avatar name={row.name} url={row.avatarUrl}/><span className="challenge-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
      <strong>{formatLeaderboardValue(row.value, row.unit)}</strong>
    </li>)}</ol>
    {!rows.length && <p className="challenge-panel-note">
      {data.you ? t('You’re first — no other times yet.')
        : attempts < 4 ? t('Syncing your result…') : t('No posted times yet.')}</p>}
    {!data.you && attempts < 4 && <p className="challenge-panel-note" role="status">{t('Syncing your result…')}</p>}
    {!data.you && attempts >= 4 && <p className="challenge-panel-note">{t('This run did not post to the challenge board.')}</p>}
    {other && onPlayOther && <button className="secondary challenge-other" onClick={() => onPlayOther(other.game)}>
      <Play size={16}/> {other.player.status === 'started' ? t('Resume the other challenge') : t('Play the other challenge')}</button>}
  </section>
}

function commentAttempt(attempt: number) { return attempt + 1 }
