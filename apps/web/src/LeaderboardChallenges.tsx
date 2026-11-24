import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatLeaderboardValue } from '../../../packages/game-sdk/src/leaderboards.js'
import { useIntl } from 'react-intl'
import type { ChallengeOccurrenceView } from '../../../packages/game-sdk/src/challenges.js'
import { api, errorMessage } from './api.js'
import { findGame } from './registry.js'
import { knownMessage, useT } from './i18n.js'
import type { Message } from './messages.js'
import type { ChallengeDayView, ChallengeSlotView } from './Challenges.js'

type Link = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void
interface HistoryData {
  occurrences: { occurrence: ChallengeOccurrenceView; slots: ChallengeSlotView[] }[]
  nextBefore: string | null
}

function playerStatus(t: ReturnType<typeof useT>, slot: ChallengeSlotView) {
  switch (slot.player.status) {
    case 'completed': return t('Completed')
    case 'started': return t('In progress')
    case 'available': return t('Ready')
    case 'closed':
    case 'expired': return t('Not completed')
    case 'missed': return t('Not played')
    default: return t('Unavailable')
  }
}

function optionText(t: ReturnType<typeof useT>, slot: ChallengeSlotView) {
  const size = slot.options.size
  const difficulty = slot.options.difficulty
  return [size ? `${size} × ${size}` : '', typeof difficulty === 'string' ? t(difficulty as Message) : '']
    .filter(Boolean).join(' · ')
}

export function LeaderboardChallenges({ accountId, online, link }: {
  accountId?: string; online: boolean; link: Link
}) {
  const t = useT()
  const intl = useIntl()
  const [day, setDay] = useState<ChallengeDayView>()
  const [history, setHistory] = useState<HistoryData>()
  const [problem, setProblem] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreProblem, setMoreProblem] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!online) { setDay(undefined); setHistory(undefined); return }
    let current = true
    setProblem(''); setLoading(true)
    void Promise.all([
      api<ChallengeDayView>('/challenges', undefined, accountId),
      api<HistoryData>('/challenges/history?limit=20', undefined, accountId),
    ]).then(([today, older]) => {
      if (!current) return
      setDay(today); setHistory(older); setLoading(false)
    }, error => {
      if (current) { setProblem(errorMessage(error)); setLoading(false) }
    })
    return () => { current = false }
  }, [accountId, online, reload])
  useEffect(() => {
    if (!day?.occurrence) return
    const ends = Date.parse(day.occurrence.endsAt)
    const timer = setTimeout(() => setReload(value => value + 1),
      Math.max(0, Math.min(ends - Date.now() + 1000, 2_147_000_000)))
    const visible = () => { if (document.visibilityState === 'visible') setReload(value => value + 1) }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [day?.occurrence?.id, day?.occurrence?.endsAt])
  const gameTitle = (game: string) => {
    const meta = findGame(game)
    return meta ? knownMessage(t, meta.title) : game
  }
  const date = (iso: string, timeZone: string) =>
    intl.formatDate(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short', timeZone })
  async function loadOlder() {
    if (!history?.nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      setMoreProblem('')
      const next = await api<HistoryData>('/challenges/history?limit=20&before=' +
        encodeURIComponent(history.nextBefore), undefined, accountId)
      setHistory({ ...next, occurrences: [...history.occurrences, ...next.occurrences] })
    } catch (error) {
      setMoreProblem(errorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }
  if (!online) return <p className="notice">{t('Connect to view leaderboards.')}</p>
  if (problem) return <p className="error" role="alert">{knownMessage(t, problem)}</p>
  if (loading && !day) return <p role="status">{t('Loading…')}</p>
  return <section className="leaderboard-challenges" aria-label={t('Challenges')}>
    {day?.occurrence ? <section className="leaderboard-challenge-today panel">
      <div className="section-heading">
        <h2>{t('Today’s challenge')}</h2>
        <a className="text-button" href="/challenges" onClick={event => link(event, '/challenges')}>
          {t('Open daily challenges')} <ChevronRight size={16}/></a>
      </div>
      <div className="leaderboard-challenge-games">
        {day.slots.map(slot => {
          const href = '/challenges/' + day.occurrence!.id + '/' + slot.game
          return <a className="leaderboard-challenge-game" href={href} key={slot.id}
            onClick={event => link(event, href)}>
            <span className="leaderboard-challenge-game-title">{gameTitle(slot.game)}</span>
            {optionText(t, slot) && <span className="muted">{optionText(t, slot)}</span>}
            <span className={'badge challenge-status status-' + slot.player.status}>{playerStatus(t, slot)}</span>
            {slot.player.result?.rank ? <span className="leaderboard-challenge-rank">
              #{slot.player.result.rank} / {slot.player.result.total}</span> : null}
            <ChevronRight size={17} aria-hidden="true"/>
          </a>
        })}
      </div>
    </section> : !loading && <p className="empty">{t('No daily challenge today.')}</p>}
    <div className="section-heading"><h2>{t('Past challenges')}</h2></div>
    {history?.occurrences.length ? <div className="leaderboard-challenge-days">
      {history.occurrences.map(({ occurrence, slots }) => {
        const winners = slots.flatMap(slot => {
          const row = slot.standings.top.find(item => item.rank === 1)
          return row ? [{ game: gameTitle(slot.game), row }] : []
        })
        return <a className="leaderboard-challenge-day panel"
          href={'/challenges/' + occurrence.id} key={occurrence.id}
          onClick={event => link(event, '/challenges/' + occurrence.id)}>
          <span className="leaderboard-challenge-date">{date(occurrence.startsAt, occurrence.timezone)}</span>
          <span className="leaderboard-challenge-games-list">{slots.map(slot => gameTitle(slot.game)).join(' · ')}</span>
          <span className="muted leaderboard-challenge-winner">{winners.length
            ? winners.map(({ game, row }) => `${game}: ${row.name} · ${formatLeaderboardValue(row.value, row.unit)}`).join(' · ')
            : t('No posted times yet.')}</span>
          <ChevronRight size={17} aria-hidden="true"/>
        </a>
      })}
    </div> : !loading && <p className="empty">{t('No challenge history yet.')}</p>}
    {history?.nextBefore && <div className="button-bar">
      <button className="secondary" onClick={loadOlder} disabled={loadingMore}>
        {loadingMore ? t('Loading…') : t('Load older')}</button>
      {moreProblem && <p className="error" role="alert">{knownMessage(t, moreProblem)}</p>}
    </div>}
  </section>
}
