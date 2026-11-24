import { useEffect, useState } from 'react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { formatLeaderboardValue, type LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { api, errorMessage } from './api.js'
import { Avatar } from './Avatar.js'
import { gameBoardHref } from './game-definitions.js'
import { resultRows } from './standings.js'
import type { WebGame } from './game-web.js'
import { useT } from './i18n.js'

interface BoardDetail {
  top: LeaderboardStanding[]
  you: LeaderboardStanding | null
  total: number
}

/**
 * All-mode after-game standings. The played level's board is the primary board
 * for Quick Play and packs; the platform API supplies top three plus the viewer.
 */
export function ResultStandingsPanel({ game, level, accountId, online }: {
  game: WebGame; level: GameLevel; accountId?: string; online: boolean
}) {
  const t = useT()
  const [data, setData] = useState<BoardDetail>()
  const [problem, setProblem] = useState('')
  const [attempts, setAttempts] = useState(0)
  const href = gameBoardHref(game.id, level)
  const key = href?.split('/board/')[1]
  useEffect(() => {
    if (!online || !key) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setProblem('')
    const load = (attempt: number) => {
      void api<BoardDetail>('/leaderboards/games/' + encodeURIComponent(game.id) + '/boards/' +
        encodeURIComponent(decodeURIComponent(key)), undefined, accountId).then(value => {
        if (!current) return
        setData(value)
        if (!value.you && attempt < 5) timer = setTimeout(() => load(attempt + 1), 800 * (attempt + 1))
        else setAttempts(attempt)
      }, error => { if (current) { setProblem(errorMessage(error)); setAttempts(attempt) } })
    }
    load(0)
    return () => { current = false; if (timer) clearTimeout(timer) }
  }, [accountId, game.id, key, online])
  if (!href) return null
  if (!online) return <p className="challenge-panel-note">{t('Standings will appear when you’re online.')}</p>
  if (problem) return <p className="challenge-panel-note" role="alert">{t('Standings unavailable.')}</p>
  if (!data) return <p className="challenge-panel-note" role="status">{t('Posting your result…')}</p>
  const rows = resultRows(data.top, data.you, data.total)
  return <section className="challenge-panel" aria-label={t('Leaderboard standings')}>
    <div className="challenge-panel-head"><span className="eyebrow">{t(level.pack ? 'This puzzle’s standings' : 'Standings')}</span>
      <span className="muted">{t('{count, plural, one {# player} other {# players}}', { count: data.total })}</span></div>
    <ol className="challenge-mini">{rows.map(row => <li key={row.rank + ':' + row.name} data-you={row.you || undefined}>
      <span className="challenge-rank">{row.rank}</span><Avatar name={row.name} url={row.avatarUrl}/>
      <span className="challenge-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
      <strong>{formatLeaderboardValue(row.value, row.unit)}</strong>
    </li>)}</ol>
    {!rows.length && !data.you && attempts >= 5 && <p className="challenge-panel-note">{t('No posted times yet.')}</p>}
    {!data.you && attempts < 5 && <p className="challenge-panel-note" role="status">{t('Syncing your result…')}</p>}
    {!data.you && attempts >= 5 && <p className="challenge-panel-note">{t('Your result is not on this board.')}</p>}
    {level.pack && <a className="text-button challenge-other" href={'/games/' + game.id + '/leaderboards/pack/' +
      encodeURIComponent(level.pack.id) + '/' + level.pack.revision}>{t('Pack leaderboard')}</a>}
  </section>
}

