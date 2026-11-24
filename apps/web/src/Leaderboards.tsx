import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, ChevronRight, Search, Trophy } from 'lucide-react'
import { useIntl, type IntlShape } from 'react-intl'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type {
  LeaderboardBoardInfo, LeaderboardCooldown, LeaderboardPackStanding, LeaderboardPackSummary,
  LeaderboardPlayerResult, LeaderboardPlayerSummary, LeaderboardRecords, LeaderboardRemovalNotice,
  LeaderboardStanding, LeaderboardSummary,
} from '../../../packages/game-sdk/src/leaderboards.js'
import { formatLeaderboardValue } from '../../../packages/game-sdk/src/leaderboards.js'
import { api, errorMessage } from './api.js'
import type { WebGame } from './game-web.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import type { Message } from './messages.js'
import { findGame } from './registry.js'
import type { LocalSession } from './storage.js'

interface CatalogEntry extends LeaderboardSummary { game: string; player: LeaderboardPlayerSummary }
interface CatalogData { games: CatalogEntry[]; player: LeaderboardPlayerSummary }
interface HubLevel extends LeaderboardSummary { level: GameLevel }
interface HubData {
  game: string; quick: LeaderboardSummary[]; packs: LeaderboardPackSummary[]; standalone: HubLevel[]
  player: LeaderboardPlayerSummary
}
interface BoardDetail extends LeaderboardSummary { level?: GameLevel; cooldown?: LeaderboardCooldown | null }
interface PackDetail extends Omit<LeaderboardPackSummary, 'levels'> { levels: HubLevel[] }

type Link = (event: MouseEvent<HTMLAnchorElement>, href: string) => void
const boardPath = (game: string, key: string) =>
  '/games/' + game + '/leaderboards/board/' + encodeURIComponent(key)
const packPath = (game: string, id: string, revision: number) =>
  '/games/' + game + '/leaderboards/pack/' + encodeURIComponent(id) + '/' + revision

async function copyText(text: string) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* Fall through for HTTP test origins. */ }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try { return document.execCommand('copy') } catch { return false } finally { area.remove() }
}

export function leaderboardBoardTitle(t: Translate, board: LeaderboardBoardInfo, game?: WebGame) {
  if (board.kind === 'quick') {
    const title = game ? knownMessage(t, game.title) : board.game
    const difficulty = board.difficulty ? t(board.difficulty as Message) : ''
    return board.size
      ? t('{difficulty} {size} × {size} {game}', { difficulty, size: board.size, game: title })
      : t('{difficulty} {game}', { difficulty, game: title })
  }
  const level = board.levelTitle ? knownMessage(t, board.levelTitle) : t('Puzzle')
  return board.packTitle ? t('{pack} · {level}', { pack: knownMessage(t, board.packTitle), level }) : level
}

function relativeDate(t: Translate, intl: IntlShape, iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 1) return t('Today')
  if (days < 2) return t('Yesterday')
  if (days < 7) return t('{count}d ago', { count: days })
  return intl.formatDate(date, { day: 'numeric', month: 'short' })
}

function fullDate(intl: IntlShape, iso: string) {
  return intl.formatDate(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })
}

function boardGame(board: LeaderboardBoardInfo) {
  return findGame(board.game)
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed)
    return <img className="leaderboard-avatar" src={url} alt="" referrerPolicy="no-referrer" loading="lazy"
      onError={() => setFailed(true)}/>
  return <span className="leaderboard-avatar leaderboard-avatar-initials" aria-hidden="true">
    {(name.trim().slice(0, 1) || '?').toUpperCase()}</span>
}

function PlayerStat({ kind, result }: { kind: 'last' | 'best'; result: LeaderboardPlayerResult }) {
  const t = useT()
  const intl = useIntl()
  const game = boardGame(result.board)
  const value = kind === 'last' ? formatLeaderboardValue(result.value, result.unit) : '#' + result.rank
  return <a className="leaderboard-stat" href={boardPath(result.game, result.board.key)}
    aria-label={t(kind === 'last' ? 'Last posted: {value} on {board}' : 'Best rank: {value} on {board}',
      { value, board: leaderboardBoardTitle(t, result.board, game) })}>
    <span className="leaderboard-stat-label">{t(kind === 'last' ? 'Last posted' : 'Best rank')}</span>
    <strong className="leaderboard-stat-value">{value}</strong>
    <span className="leaderboard-stat-board">{leaderboardBoardTitle(t, result.board, game)}</span>
    <span className="leaderboard-stat-meta">{kind === 'last'
      ? relativeDate(t, intl, result.recordedAt)
      : t('of {count, plural, one {# player} other {# players}}', { count: result.total })}</span>
  </a>
}

export function LeaderboardPlayerPanel({ player, game, compact = false, link }: {
  player: LeaderboardPlayerSummary; game?: WebGame; compact?: boolean; link: Link
}) {
  const t = useT()
  const tiles = [
    player.lastPosted ? <PlayerStat key="last" kind="last" result={player.lastPosted}/> : null,
    player.bestRank ? <PlayerStat key="best" kind="best" result={player.bestRank}/> : null,
  ].filter(Boolean)
  if (!tiles.length)
    return <section className={'leaderboard-player panel' + (compact ? ' compact' : '')}>
      <p className="eyebrow">{t('Your play')}</p>
      <p className="leaderboard-player-empty">{t('No posted results')}</p>
      <a className="text-button" href={game ? game.url : '/'} onClick={event => link(event, game ? game.url : '/')}>
        {game ? t('Play {game}', { game: knownMessage(t, game.title) }) : t('Open a game')}
      </a>
    </section>
  return <section className={'leaderboard-player panel' + (compact ? ' compact' : '')}>
    <div className="leaderboard-player-heading"><p className="eyebrow">{t('Your play')}</p>
      {player.posted > 0 && <span className="muted">{t('{posted, plural, one {# post} other {# posts}} · {boards, plural, one {# board} other {# boards}}',
        { posted: player.posted, boards: player.boards })}</span>}
    </div>
    <div className="leaderboard-stats">{tiles}</div>
  </section>
}

function MiniTop({ rows }: { rows: readonly LeaderboardStanding[] }) {
  const t = useT()
  if (!rows.length) return <p className="leaderboard-empty-line">{t('No posted times')}</p>
  return <ol className="leaderboard-mini">{rows.slice(0, 3).map((row, index) => <li key={row.rank + ':' + index}
    data-you={row.you || undefined}>
    <span>{row.rank}</span><Avatar name={row.name} url={row.avatarUrl}/><span>{row.name}</span>
    <span>{formatLeaderboardValue(row.value, row.unit)}</span>
  </li>)}</ol>
}

function GameCard({ entry, game, link }: { entry: CatalogEntry; game: WebGame; link: Link }) {
  const t = useT()
  const href = game.url + '/leaderboards'
  const best = entry.player.bestRank
  return <a className="leaderboard-card panel leaderboard-game-card" href={href} onClick={event => link(event, href)}>
    <div className="leaderboard-card-head"><h2>{knownMessage(t, game.title)}</h2><Trophy size={21} aria-hidden="true"/></div>
    <p>{t(game.description)}</p>
    <div className="leaderboard-card-scope">
      <span className="eyebrow">{leaderboardBoardTitle(t, entry.board, game)}</span>
      <span className="badge">{t('{count, plural, one {# player} other {# players}}', { count: entry.total })}</span>
    </div>
    <MiniTop rows={entry.top}/>
    <div className="leaderboard-card-foot">
      {best ? <span className="leaderboard-personal">{t('Your best #{rank} · {board}',
        { rank: best.rank, board: leaderboardBoardTitle(t, best.board, game) })}</span>
        : <span className="muted">{t('No result yet')}</span>}
      <span className="text-button">{t('View boards')} <ChevronRight size={16}/></span>
    </div>
  </a>
}

export function LeaderboardCatalog({ games, sessions, accountId, online, link }: {
  games: readonly WebGame[]; sessions: readonly LocalSession[]; accountId?: string; online: boolean; link: Link
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [data, setData] = useState<CatalogData>()
  const [problem, setProblem] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!online) { setData(undefined); return }
    let current = true
    setProblem(''); setLoading(true)
    void api<CatalogData>('/leaderboards', undefined, accountId).then(
      value => { if (current) { setData(value); setLoading(false) } },
      error => { if (current) { setProblem(errorMessage(error)); setLoading(false) } })
    return () => { current = false }
  }, [accountId, online])
  const participating = games.filter(game => game.leaderboards)
  const recent = new Set(sessions.map(session => session.data.game))
  const term = query.trim().toLowerCase()
  const ordered = [...participating].sort((a, b) =>
    Number(recent.has(b.id)) - Number(recent.has(a.id)) || knownMessage(t, a.title).localeCompare(knownMessage(t, b.title)))
  const matches = ordered.filter(game =>
    (knownMessage(t, game.title) + ' ' + t(game.description)).toLowerCase().includes(term))
  return <section className="catalog leaderboard-catalog">
    <div className="section-heading">
      <h1>{t('Leaderboards')}</h1>
      <label className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)}
        placeholder={t('Search games')} aria-label={t('Search games')}/></label>
    </div>
    {!online && <p className="notice">{t('Connect to view leaderboards.')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {loading && <p role="status">{t('Loading…')}</p>}
    {data && <LeaderboardPlayerPanel player={data.player} link={link}/>}
    {data && <section className="leaderboard-games-section">
      <div className="section-heading"><h2>{t('Games')}</h2>
        <span className="badge">{t('{count, plural, one {# game} other {# games}}', { count: matches.length })}</span></div>
      <div className="leaderboard-games">{matches.map(game => {
        const entry = data.games.find(item => item.game === game.id)
        return entry ? <GameCard key={game.id} entry={entry} game={game} link={link}/> : null
      })}</div>
      {!matches.length && <p className="empty">{t('No games match this view.')}</p>}
    </section>}
  </section>
}

function QuickCard({ entry, game, link }: { entry: LeaderboardSummary; game: WebGame; link: Link }) {
  const t = useT()
  const href = boardPath(game.id, entry.board.key)
  const title = entry.board.size
    ? t('{size} × {size}', { size: entry.board.size })
    : entry.board.difficulty ? t(entry.board.difficulty as Message) : leaderboardBoardTitle(t, entry.board, game)
  return <a className="leaderboard-card panel leaderboard-quick-card" href={href} onClick={event => link(event, href)}>
    <div className="leaderboard-card-head"><h3>{title}</h3>
      {entry.board.size && entry.board.difficulty &&
        <span className={'badge ' + entry.board.difficulty.toLowerCase()}>{t(entry.board.difficulty as Message)}</span>}</div>
    <p className="leaderboard-card-meta">{t('{count, plural, one {# player} other {# players}}', { count: entry.total })}</p>
    <MiniTop rows={entry.top}/>
    <span className="leaderboard-row-chevron" aria-hidden="true"><ChevronRight size={17}/></span>
  </a>
}

function BoardRow({ entry, game, link }: { entry: HubLevel; game: WebGame; link: Link }) {
  const t = useT()
  const href = boardPath(game.id, entry.board.key)
  return <a className="leaderboard-board-row" href={href} onClick={event => link(event, href)}>
    <span className="leaderboard-board-main">
      <strong>{game.packs?.levelTitle(t, entry.level) ?? knownMessage(t, entry.level.title)}</strong>
      {game.packs && <span className="badge">{game.packs.detail(t, entry.level)}</span>}
    </span>
    <span className="leaderboard-board-meta">
      <span>{t('{count, plural, one {# player} other {# players}}', { count: entry.total })}</span>
      {entry.top[0] && <span className="leaderboard-best"><span className="eyebrow">{t('Best')}</span>
        <Avatar name={entry.top[0].name} url={entry.top[0].avatarUrl}/>
        <span>{entry.top[0].name}</span>
        <strong>{formatLeaderboardValue(entry.top[0].value, entry.top[0].unit)}</strong></span>}
      {entry.you && <span className="badge you-badge">{t('You')} #{entry.you.rank}</span>}
    </span>
    <span className="leaderboard-row-chevron" aria-hidden="true"><ChevronRight size={17}/></span>
  </a>
}

function PackMiniTop({ rows }: { rows: readonly LeaderboardPackStanding[] }) {
  const t = useT()
  if (!rows.length) return <p className="leaderboard-empty-line">{t('No pack results yet')}</p>
  return <ol className="leaderboard-mini leaderboard-pack-mini">{rows.slice(0, 3).map(row => <li key={row.rank + ':' + row.name}
    data-you={row.you || undefined}>
    <span>{row.rank}</span><Avatar name={row.name} url={row.avatarUrl}/><span>{row.name}</span>
    <span>{formatLeaderboardValue(row.total, 'ms')}</span>
  </li>)}</ol>
}

function PackCard({ pack, game, link }: { pack: LeaderboardPackSummary; game: WebGame; link: Link }) {
  const t = useT()
  const href = packPath(game.id, pack.id, pack.revision)
  const you = pack.you
  return <a className="leaderboard-card panel leaderboard-pack-card" href={href} onClick={event => link(event, href)}>
    <div className="leaderboard-card-head"><h3>{knownMessage(t, pack.title)}</h3><ChevronRight size={18}/></div>
    <p className="leaderboard-card-meta">{t('{count} levels', { count: pack.levels })} · {t('{count, plural, one {# player} other {# players}}', { count: pack.players })}</p>
    <PackMiniTop rows={pack.top}/>
    <div className="leaderboard-card-foot">
      {you ? <span className="leaderboard-personal">{t('Your total')} {formatLeaderboardValue(you.total, 'ms')}
        {you.rank ? ' · #' + you.rank : ' · ' + t('{solved} of {total} levels', { solved: you.levels, total: pack.levels })}</span>
        : <span className="muted">{t('No pack results yet')}</span>}
      <span className="text-button">{t('View pack')} <ChevronRight size={16}/></span>
    </div>
  </a>
}

function PackStandings({ rows, players, levels, title }: {
  rows: readonly LeaderboardPackStanding[]; players: number; levels: number; title: string
}) {
  const t = useT()
  if (!rows.length) return null
  return <section className="leaderboard-standings">
    <div className="leaderboard-table-wrap"><table className="leaderboard-table">
      <caption className="visually-hidden">{t('Pack standings for {pack}', { pack: title })}</caption>
      <thead><tr><th scope="col">{t('Rank')}</th><th scope="col">{t('Player')}</th>
        <th scope="col">{t('Total')}</th><th scope="col">{t('Levels')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.name + ':' + row.rank} data-you={row.you || undefined}>
        <td className="leaderboard-rank"><span className={'leaderboard-rank-value' +
          (row.rank && row.rank <= 3 ? ' leaderboard-rank-medal medal-' + row.rank : '')}>{row.rank ?? '—'}</span></td>
        <td className="leaderboard-player-cell"><div className="leaderboard-player-inner">
          <Avatar name={row.name} url={row.avatarUrl}/>
          <span className="leaderboard-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
        </div></td>
        <td className="leaderboard-time">{formatLeaderboardValue(row.total, 'ms')}</td>
        <td>{row.levels} / {levels}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="leaderboard-table-foot"><span className="muted">{t('Top {shown} of {total}', {
      shown: rows.length, total: players })}</span></div>
  </section>
}

export function GameLeaderboards({ game, accountId, online, link, back }: {
  game: WebGame; accountId?: string; online: boolean; link: Link; back: () => void
}) {
  const t = useT()
  const [hub, setHub] = useState<HubData>()
  const [problem, setProblem] = useState('')
  useEffect(() => {
    if (!online) { setHub(undefined); return }
    let current = true
    setProblem('')
    void api<HubData>(`/leaderboards/games/${game.id}`, undefined, accountId).then(
      value => { if (current) setHub(value) },
      error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId, game.id, online])
  return <section className="catalog leaderboard-hub">
    <div className="game-navigation"><button className="text-button back" onClick={back}>
      <ArrowLeft size={17}/> {t('Back')}</button>
      <a className="text-button" href="/leaderboards" onClick={event => link(event, '/leaderboards')}>{t('All leaderboards')}</a></div>
    <div className="section-heading"><h1>{t('{game} leaderboards', { game: knownMessage(t, game.title) })}</h1></div>
    {!online && <p className="notice">{t('Connect to view leaderboards.')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {hub ? <>
      <LeaderboardPlayerPanel player={hub.player} game={game} compact link={link}/>
      <section className="leaderboard-section">
        <div className="section-heading"><h2>{t('Quick Play')}</h2>
          <span className="badge">{t('{count, plural, one {# board} other {# boards}}', { count: hub.quick.length })}</span></div>
        <div className="leaderboard-quick-grid">{hub.quick.map(entry =>
          <QuickCard key={entry.board.key} entry={entry} game={game} link={link}/>)}</div>
      </section>
      {hub.packs.length > 0 && <section className="leaderboard-section">
        <div className="section-heading"><h2>{t('Packs')}</h2>
          <span className="badge">{t('{count, plural, one {# pack} other {# packs}}', { count: hub.packs.length })}</span></div>
        <div className="leaderboard-games leaderboard-packs">{hub.packs.map(pack =>
          <PackCard key={pack.id + ':' + pack.revision} pack={pack} game={game} link={link}/>)}</div>
      </section>}
      {hub.standalone.length > 0 && <section className="leaderboard-section">
        <div className="section-heading"><h2>{t('Puzzles')}</h2>
          <span className="badge">{t('{count, plural, one {# board} other {# boards}}', { count: hub.standalone.length })}</span></div>
        <div className="panel leaderboard-board-list">{hub.standalone.map(entry =>
          <BoardRow key={entry.board.key} entry={entry} game={game} link={link}/>)}</div>
      </section>}
    </> : online ? <p role="status">{t('Loading…')}</p> : null}
  </section>
}

function SeedChip({ code }: { code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (await copyText(code)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  return <button type="button" className="leaderboard-seed" title={code} aria-label={t('Copy seed')} onClick={copy}>
    {copied ? t('Copied') : code.length > 14 ? code.slice(0, 14) + '…' : code}
  </button>
}

function StandingsTable({ rows, total, board, game, play, title, label = 'top' }: {
  rows: readonly LeaderboardStanding[]; total: number; board: LeaderboardBoardInfo; game: WebGame
  play: (level: GameLevel) => void; title: string; label?: 'top' | 'all'
}) {
  const t = useT()
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)
  if (!rows.length) return null
  const initial = rows.filter(row => row.rank <= 10)
  const visible = expanded ? rows : initial
  const showBoard = board.kind === 'quick'
  const tiedRanks = new Set(rows.flatMap((row, index) =>
    rows[index - 1]?.rank === row.rank || rows[index + 1]?.rank === row.rank ? [row.rank] : []))
  return <section className="leaderboard-standings">
    <div className="leaderboard-table-wrap">
      <table className="leaderboard-table">
        <caption className="visually-hidden">{t('Standings for {board}', { board: title })}</caption>
        <thead><tr><th scope="col">{t('Rank')}</th><th scope="col">{t('Player')}</th>
          <th scope="col">{t('Time')}</th>{showBoard && <th scope="col">{t('Board')}</th>}</tr></thead>
        <tbody>{visible.map(row => <tr key={row.rank + ':' + row.name + ':' + row.recordedAt}
          data-you={row.you || undefined} data-tie={tiedRanks.has(row.rank) || undefined}>
          <td className="leaderboard-rank">
            <span className={'leaderboard-rank-value' + (row.rank <= 3 ? ' leaderboard-rank-medal medal-' + row.rank : '')}
              aria-label={tiedRanks.has(row.rank) ? t('Rank {rank}, tied', { rank: row.rank }) : t('Rank {rank}', { rank: row.rank })}>
              {row.rank}
            </span>
          </td>
          <td className="leaderboard-player-cell"><div className="leaderboard-player-inner">
            <Avatar name={row.name} url={row.avatarUrl}/>
            <span className="leaderboard-name">{row.name}{row.you && <span className="badge you-badge">{t('You')}</span>}</span>
            <span className="leaderboard-when" title={fullDate(intl, row.recordedAt)}>{relativeDate(t, intl, row.recordedAt)}</span>
          </div></td>
          <td className="leaderboard-time">{formatLeaderboardValue(row.value, row.unit)}</td>
          {showBoard && <td className="leaderboard-board-cell"><div className="leaderboard-board-inner">
            {row.seedCode && <SeedChip code={row.seedCode}/>}
            {row.level && <button className="text-button leaderboard-play" aria-label={t('Play this board')}
              onClick={() => play(row.level!)}>{t('Play')}</button>}
          </div></td>}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="leaderboard-table-foot">
      <span className="muted">{t(label === 'all' ? 'Showing {shown} of {total}' : 'Top {shown} of {total}', {
        shown: visible.length, total })}</span>
      {rows.length > initial.length && <button className="text-button" onClick={() => setExpanded(!expanded)}>
        {expanded ? t('Show less') : t('Show 20')}</button>}
    </div>
  </section>
}

function PlayerBestStrip({ you, cooldown, total, play, playLabel }: {
  you: LeaderboardStanding | null; cooldown?: LeaderboardCooldown | null; total: number
  play?: () => void; playLabel?: string
}) {
  const t = useT()
  const intl = useIntl()
  if (you) return <div className="leaderboard-you panel">
    <span className="eyebrow">{t('Your best')}</span>
    <strong>#{you.rank}</strong>
    <span>{formatLeaderboardValue(you.value, you.unit)}</span>
    <span className="muted">{t('of {count, plural, one {# player} other {# players}}', { count: total })}</span>
    <span className="muted">{relativeDate(t, intl, you.recordedAt)}</span>
  </div>
  if (cooldown) {
    const days = Math.max(1, Math.ceil((Date.parse(cooldown.visibleAt) - Date.now()) / 86_400_000))
    return <div className="leaderboard-you panel">
      <span className="eyebrow">{t('Repeat saved')}</span>
      <span>{t('posts in {count, plural, one {# day} other {# days}}', { count: days })}</span>
    </div>
  }
  return <div className="leaderboard-you panel">
    <span className="eyebrow">{t('No posted time')}</span>
    {play && <button className="text-button" onClick={play}>{playLabel ?? t('Play this board')}</button>}
  </div>
}

export function LeaderboardBoardView({ game, boardKey, accountId, online, back, play, openGame }: {
  game: WebGame; boardKey: string; accountId?: string; online: boolean; back: () => void
  play: (level: GameLevel) => void; openGame: () => void
}) {
  const t = useT()
  const [detail, setDetail] = useState<BoardDetail>()
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'best' | 'all'>('best')
  const [records, setRecords] = useState<LeaderboardRecords>()
  const [recordsProblem, setRecordsProblem] = useState('')
  const [loadingRecords, setLoadingRecords] = useState(false)
  useEffect(() => {
    if (!online) { setDetail(undefined); return }
    let current = true
    setDetail(undefined); setProblem('')
    void api<BoardDetail>(`/leaderboards/games/${game.id}/boards/${encodeURIComponent(boardKey)}`,
      undefined, accountId).then(
      value => { if (current) setDetail(value) },
      error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId, boardKey, game.id, online])
  useEffect(() => {
    if (mode !== 'all' || !detail || !online) return
    let current = true
    setRecordsProblem(''); setLoadingRecords(true)
    void api<LeaderboardRecords>(`/leaderboards/games/${game.id}/boards/${encodeURIComponent(boardKey)}/records?offset=0&limit=50`,
      undefined, accountId).then(
      value => { if (current) { setRecords(value); setLoadingRecords(false) } },
      error => { if (current) { setRecordsProblem(errorMessage(error)); setLoadingRecords(false) } })
    return () => { current = false }
  }, [accountId, boardKey, detail, game.id, mode, online])
  async function loadMoreRecords() {
    const offset = records?.rows.length ?? 0
    setLoadingRecords(true); setRecordsProblem('')
    try {
      const value = await api<LeaderboardRecords>(`/leaderboards/games/${game.id}/boards/${encodeURIComponent(boardKey)}/records?offset=${offset}&limit=50`,
        undefined, accountId)
      setRecords(previous => previous ? { rows: [...previous.rows, ...value.rows], total: value.total } : value)
    } catch (error) { setRecordsProblem(errorMessage(error)) }
    finally { setLoadingRecords(false) }
  }
  async function copyLink() {
    if (await copyText(location.href)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  const title = detail ? leaderboardBoardTitle(t, detail.board, game) : ''
  return <section className="catalog leaderboard-board">
    <div className="game-navigation"><button className="text-button back" onClick={back}>
      <ArrowLeft size={17}/> {t('Back')}</button>
      <button className="text-button" onClick={copyLink} aria-live="polite">{copied ? t('Copied') : t('Copy link')}</button></div>
    {detail ? <>
      <div className="leaderboard-board-heading">
        <div>
          <p className="eyebrow">{detail.board.kind === 'quick' ? t('Quick Play')
            : detail.board.packTitle ? knownMessage(t, detail.board.packTitle) : t('Puzzles')}</p>
          <h1>{title}</h1>
          <div className="leaderboard-board-meta">
            {detail.board.difficulty
              ? <span className="badge">{t(detail.board.difficulty as Message)}</span>
              : detail.level && game.packs
                ? <span className="badge">{game.packs.detail(t, detail.level)}</span> : null}
            <span className="badge">{t('{count, plural, one {# player} other {# players}}', { count: detail.total })}</span>
          </div>
        </div>
        {detail.level && <button className="primary" onClick={() => play(detail.level!)}>{t('Play this board')}</button>}
      </div>
      <PlayerBestStrip you={detail.you} cooldown={detail.cooldown} total={detail.total}
        play={detail.level ? () => play(detail.level!) : openGame}
        playLabel={detail.level ? t('Play this board') : t('Play a puzzle')}/>
      {detail.top.length > 0 && <div className="tabs" role="group" aria-label={t('Records')}>
        <button type="button" aria-pressed={mode === 'best'} onClick={() => setMode('best')}>{t('Standings')}</button>
        <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>{t('All records')}</button>
      </div>}
      {mode === 'best' ? (detail.top.length ? <StandingsTable rows={detail.top} total={detail.total} board={detail.board}
        game={game} play={play} title={title}/> : <div className="empty leaderboard-empty">
        <Trophy size={28} aria-hidden="true"/>
        <h2>{t('No posted times')}</h2>
        {detail.level
          ? <button className="primary" onClick={() => play(detail.level!)}>{t('Play this board')}</button>
          : <button className="primary" onClick={openGame}>{t('Play a puzzle')}</button>}
      </div>) : <>
        {recordsProblem && <p className="error" role="alert">{knownMessage(t, recordsProblem)}</p>}
        {records && records.rows.length > 0 && <StandingsTable rows={records.rows} total={records.total}
          board={detail.board} game={game} play={play} title={title} label="all"/>}
        {records && records.rows.length === 0 && !loadingRecords &&
          <p className="empty">{t('No records yet')}</p>}
        {loadingRecords && <p role="status">{t('Loading…')}</p>}
        {records && records.rows.length < records.total &&
          <button className="secondary" disabled={loadingRecords} onClick={loadMoreRecords}>{t('Load more')}</button>}
      </>}
    </> : problem ? <p className="error" role="alert">{knownMessage(t, problem)}</p>
      : online ? <p role="status">{t('Loading…')}</p> : <p className="notice">{t('Connect to view leaderboards.')}</p>}
  </section>
}

export function LeaderboardPackView({ game, packId, revision, accountId, online, back, link }: {
  game: WebGame; packId: string; revision: number; accountId?: string; online: boolean; back: () => void; link: Link
}) {
  const t = useT()
  const [detail, setDetail] = useState<PackDetail>()
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState(false)
  const [visible, setVisible] = useState(20)
  useEffect(() => {
    if (!online) { setDetail(undefined); return }
    let current = true
    setDetail(undefined); setProblem(''); setVisible(20)
    void api<PackDetail>(`/leaderboards/games/${game.id}/packs/${encodeURIComponent(packId)}/${revision}`,
      undefined, accountId).then(
      value => { if (current) setDetail(value) },
      error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId, game.id, packId, revision, online])
  async function copyLink() {
    if (await copyText(location.href)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  const title = detail ? knownMessage(t, detail.title) : ''
  return <section className="catalog leaderboard-board leaderboard-pack-view">
    <div className="game-navigation"><button className="text-button back" onClick={back}>
      <ArrowLeft size={17}/> {t('Back')}</button>
      <button className="text-button" onClick={copyLink} aria-live="polite">{copied ? t('Copied') : t('Copy link')}</button></div>
    {detail ? <>
      <div className="leaderboard-board-heading"><div>
        <p className="eyebrow">{t('Pack')}</p>
        <h1>{title}</h1>
        <div className="leaderboard-board-meta">
          <span className="badge">{t('{count} levels', { count: detail.levels.length })}</span>
          <span className="badge">{t('{count, plural, one {# player} other {# players}}', { count: detail.players })}</span>
        </div>
      </div></div>
      <div className="leaderboard-you panel">
        <span className="eyebrow">{t('Your total')}</span>
        {detail.you ? <>
          <strong>{formatLeaderboardValue(detail.you.total, 'ms')}</strong>
          <span className="muted">{t('{solved} of {total} levels', {
            solved: detail.you.levels, total: detail.levels.length })}</span>
          {detail.you.rank && <span className="badge">#{detail.you.rank}</span>}
        </> : <span className="muted">{t('No pack results yet')}</span>}
        {detail.top[0] && <span className="leaderboard-best"><span className="eyebrow">{t('Best overall')}</span>
          <Avatar name={detail.top[0].name} url={detail.top[0].avatarUrl}/>
          <span>{detail.top[0].name}</span>
          <strong>{formatLeaderboardValue(detail.top[0].total, 'ms')}</strong></span>}
      </div>
      {detail.top.length > 0 && <PackStandings rows={detail.top} players={detail.players}
        levels={detail.levels.length} title={title}/>}
      <section className="leaderboard-section">
        <div className="section-heading"><h2>{t('Levels')}</h2>
          <span className="badge">{detail.levels.length}</span></div>
        <div className="panel leaderboard-board-list">{detail.levels.slice(0, visible).map(entry =>
          <BoardRow key={entry.board.key} entry={entry} game={game} link={link}/>)}</div>
        {visible < detail.levels.length && <button className="secondary"
          onClick={() => setVisible(visible + 20)}>{t('Load more levels')}</button>}
      </section>
    </> : problem ? <p className="error" role="alert">{knownMessage(t, problem)}</p>
      : online ? <p role="status">{t('Loading…')}</p>
      : <p className="notice">{t('Connect to view leaderboards.')}</p>}
  </section>
}

export function LeaderboardNotice({ notice, onAcknowledge }: {
  notice: LeaderboardRemovalNotice; onAcknowledge: () => void
}) {
  const t = useT()
  const intl = useIntl()
  const dialog = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    button.current?.focus()
  }, [])
  useEffect(() => {
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [])
  const game = findGame(notice.board.game)
  return <div className="settings-overlay leaderboard-notice-overlay">
    <section ref={dialog} className="settings-panel leaderboard-notice" role="dialog" aria-modal="true"
      aria-labelledby="leaderboard-removal-title" aria-describedby="leaderboard-removal-details">
      <h2 id="leaderboard-removal-title">{t('Result removed')}</h2>
      <dl id="leaderboard-removal-details" className="leaderboard-notice-details">
        <dt>{t('Board')}</dt><dd>{leaderboardBoardTitle(t, notice.board, game)}</dd>
        <dt>{t('Time')}</dt><dd>{formatLeaderboardValue(notice.value, notice.unit)}</dd>
        <dt>{t('Removed by')}</dt><dd>{notice.adminName}</dd>
        <dt>{t('Removed')}</dt><dd>{fullDate(intl, notice.removedAt)}</dd>
        <dt>{t('Reason')}</dt><dd>{notice.reason}</dd>
      </dl>
      <button ref={button} className="primary" onClick={onAcknowledge}>{t('Understood')}</button>
    </section>
  </div>
}
