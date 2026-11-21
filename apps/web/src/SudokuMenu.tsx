import { useIntl } from 'react-intl'
import { levelTitle, packDescription, packTitle } from './sudoku-copy.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Share2, Shuffle } from 'lucide-react'
import { difficulties, type Difficulty, type PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { packLevels, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { quickPlayVersion } from '../../../packages/sudoku/src/contracts.js'
import { formatSeedCode, parseSeedCode } from '../../../packages/sudoku/src/seed-code.js'
import { errorMessage } from './api.js'
import { SudokuPreview } from './Grid.js'
import { PackTrail, type PackTrailStop } from './PackTrail.js'
import { levelKey, type LocalSession } from './storage.js'

const sudokuPath = '/games/sudoku'
export const packPath = (pack: Pick<PublishedPack, 'id' | 'revision'>) => `${sudokuPath}/packs/${pack.id}/${pack.revision}`

export function PuzzleShare({ level }: { level: PublishedLevel }) {
  const t = useT()
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!level.seed || level.pack || level.generatorVersion !== quickPlayVersion) return null
  const seed = formatSeedCode(level.seed, level.difficulty, level.generatorVersion)
  async function share() {
    setCopied(false)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: seed })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    setShow(true)
  }
  return <><button className="text-button" onClick={() => { void share() }}><Share2 size={16}/>{" "}{t("Share seed")}</button>
    {show && <div className="puzzle-share">
      <input readOnly aria-label={t("Seed code")} value={seed} onFocus={event => event.target.select()}/>
      {navigator.clipboard && <button className="secondary" onClick={() => {
        void navigator.clipboard.writeText(seed).then(() => setCopied(true)).catch(() => undefined)
      }}>{copied ? t("Copied") : t("Copy seed")}</button>}
    </div>}
  </>
}

export function QuickPlay({ canPlay, profile, generate }: {
  canPlay: boolean; profile: string
  generate: (difficulty: Difficulty, seed?: string, version?: number) => Promise<void>
}) {
  const t = useT()
  const params = new URLSearchParams(location.search)
  const received = params.get('sharedSeed')?.trim() ?? ''
  const sharedCode = parseSeedCode(received)
  const difficultyKey = 'aviarium:sudoku-difficulty:' + profile
  const [difficulty, setDifficulty] = useState(() => {
    const saved = localStorage.getItem(difficultyKey)
    return difficulties.find(value => value === saved) ?? 'Easy'
  })
  const [hasSeed, setHasSeed] = useState(() => params.has('seed') || Boolean(sharedCode))
  const [seed, setSeed] = useState(() => sharedCode ? received : params.get('seed')?.slice(0, 100) ?? '')
  const legacyForm = params.has('version') && seed === params.get('seed')
  const embedded = hasSeed && !legacyForm ? parseSeedCode(seed) : undefined
  const legacyDifficulty = hasSeed && seed === params.get('seed')
    ? difficulties.find(value => value === params.get('difficulty')) : undefined
  const seedDifficulty = embedded?.difficulty ?? legacyDifficulty
  const selectedDifficulty = seedDifficulty ?? difficulty
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  return <section className="quick-play panel" aria-labelledby="quick-title">
    <form onSubmit={event => {
      event.preventDefault()
      setProblem(''); setBusy(true)
      const legacyVersion = hasSeed && legacyForm ? Number(params.get('version')) : undefined
      void generate(selectedDifficulty, hasSeed ? (embedded?.seed ?? seed.trim()) : undefined,
        embedded?.version ?? legacyVersion)
        .catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
    }}>
      <div className="quick-play-header">
        <h2 id="quick-title">{t("Quick Play")}</h2>
        <button type="button" className="text-button" aria-expanded={hasSeed} disabled={busy}
          onClick={() => setHasSeed(!hasSeed)}>{hasSeed ? t("Random seed") : t("Enter seed")}</button>
      </div>
      {hasSeed && <label className="quick-seed">{t("Puzzle seed")}<input maxLength={120} value={seed} required
        onChange={event => setSeed(event.target.value)}/></label>}
      <div className="quick-play-actions">
        <select aria-label={t("Difficulty")} value={selectedDifficulty} disabled={busy || Boolean(seedDifficulty)}
          onChange={event => {
            const next = event.target.value as Difficulty
            setDifficulty(next)
            localStorage.setItem(difficultyKey, next)
          }}>
          {difficulties.map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select>
        <button type="submit" className="primary" disabled={!canPlay || busy || (hasSeed && (!seed.trim() || (!embedded && seed.trim().length > 100)))}>
          <Shuffle size={17}/>{busy ? t("Preparing puzzle…") : hasSeed ? t("Play seed") : t("New puzzle")}
        </button>
      </div>
      {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    </form>
  </section>
}

function gradeRange(t: Translate, pack: PublishedPack) {
  const tiers = pack.data.puzzles.map(puzzle => difficulties.indexOf(puzzle.difficulty))
  const min = Math.min(...tiers), max = Math.max(...tiers)
  return min === max ? t(difficulties[min]) : t(difficulties[min]) + '–' + t(difficulties[max])
}

export function PackCards({ packs, completed, status, retry, open }: {
  packs: PublishedPack[]; completed: ReadonlySet<string>; status: 'loading' | 'ready' | 'failed'
  retry: () => void; open: (pack: PublishedPack) => void
}) {
  const t = useT()
  return <section className="sudoku-packs" aria-labelledby="packs-title">
    <h2 id="packs-title">{t("Packs")}</h2>
    {packs.length ? <div className="pack-cards">{packs.map(pack => {
      const levels = packLevels(pack)
      const solved = levels.filter(level => completed.has(levelKey(level.id, level.revision))).length
      return <button className={`pack-card pack-${pack.data.theme}`} key={pack.id} onClick={() => open(pack)}>
        {pack.data.cover && <img className="pack-cover" src={pack.data.cover} alt=""/>}
        <div className="pack-card-copy">
          <span className="pack-card-title">{packTitle(t, pack)}<ArrowRight size={18}/></span>
          <span>{gradeRange(t, pack)} · {t('{solved} of {total} solved', { solved, total: levels.length })}</span>
        </div>
      </button>
    })}</div> : status === 'loading' ? <p role="status">{t("Loading packs…")}</p>
      : status === 'failed' ? <p role="status">{t("Could not load packs.")}</p>
        : <p>{t("No packs available on this device yet.")}</p>}
    {status === 'failed' && <button className="text-button" onClick={retry}>{t("Retry loading packs")}</button>}
  </section>
}

export function displayTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function PackRoadmap({ pack, completed, sessions, canPlay, canExport, leave, play }: {
  pack: PublishedPack; completed: ReadonlySet<string>; sessions: LocalSession[]; canPlay: boolean; canExport: boolean
  leave: () => void; play: (level: PublishedLevel) => void
}) {
  const t = useT()
  const levels = packLevels(pack)
  const solved = levels.map(level => completed.has(levelKey(level.id, level.revision)))
  const next = solved.indexOf(false)
  const art = pack.data.background ?? pack.data.cover
  const stops: PackTrailStop[] = levels.map((level, index) => {
    const locked = pack.data.rules.inOrder && index > 0 && !solved[index - 1]
    const matching = sessions.filter(item => item.data.level === level.id && item.data.levelRevision === level.revision)
    const saved = matching.some(item => !item.archived && !item.data.completed && item.data.lives !== 0)
    const action = t(saved ? 'Resume' : solved[index] ? 'Replay' : 'Play')
    const title = levelTitle(t, level)
    const state = locked ? 'locked' : solved[index] ? 'solved' : next === index ? 'next' : 'available'
    const times = pack.data.rules.timeTrial ? matching.filter(item => item.data.completed)
      .map(item => item.data.elapsedMs) : []
    return { id: level.id, title, state, play: () => play(level), detail: t(level.difficulty), actionLabel: action,
      actionName: t('{action} {title}', { action, title }),
      statusLabel: locked ? t('Solve the previous stop to unlock') : solved[index] ? t('Solved')
        : next === index ? t('Up next') : undefined,
      bestTime: times.length ? t('Best {time}', { time: displayTime(Math.min(...times)) }) : undefined }
  })
  return <section className={`catalog pack-roadmap pack-${pack.data.theme}`}>
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/>{" "}{t("Sudoku menu")}</button>
      {canExport && <a className="text-button" href={`/api/packs/${pack.id}/${pack.revision}/export`} download><Download size={17}/>{" "}{t("Export pack")}</a>}
    </div>
    <header className="pack-banner">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro"><h1>{packTitle(t, pack)}</h1>
        {pack.data.description && <p>{packDescription(t, pack)}</p>}
        <p>{gradeRange(t, pack)} · {t('{solved} of {total} solved', { solved: solved.filter(Boolean).length, total: levels.length })}</p>
        <ul className="pack-tags">{[t(pack.data.rules.inOrder ? 'In order' : 'Pick & choose'),
          !pack.data.rules.hints && t('No hints'), !pack.data.rules.autoNotes && t('No Auto notes'),
          pack.data.rules.lives && t('{count, plural, one {# life} other {# lives}}', { count: pack.data.rules.lives }),
          pack.data.rules.timeTrial && t('Time trial')].filter(Boolean).map(rule => <li className="badge" key={String(rule)}>{rule}</li>)}</ul>
      </div>
    </header>
    <PackTrail key={packPath(pack)} stops={stops} canPlay={canPlay}/>
  </section>
}

export function SudokuHistory({ sessions, levels, packs, leave, replay, canPlay }: {
  sessions: LocalSession[]; levels: ReadonlyMap<string, PublishedLevel>; packs: PublishedPack[]
  leave: () => void; replay: (level: PublishedLevel) => void; canPlay: boolean
}) {
  const t = useT()
  const { formatDate } = useIntl()
  const date = (session: LocalSession) => session.data.completedAt ?? session.updated
  const history = sessions.filter(item => item.data.completed).sort((a, b) => date(b) - date(a))
  return <section className="catalog sudoku-history">
    <button className="text-button back" onClick={leave}><ArrowLeft size={17}/>{" "}{t("Sudoku menu")}</button>
    <h1>{t("History")}</h1>
    {!history.length && <p>{t("No completed puzzles yet.")}</p>}
    <ul className="history-list">{history.map(item => {
      const level = levels.get(levelKey(item.data.level, item.data.levelRevision))
      const pack = level?.pack && packs.find(pack => pack.id === level.pack?.id && pack.revision === level.pack.revision)
      return <li className="panel history-card" key={item.id}>
        {level && <div className="continue-preview"><SudokuPreview grid={level.grid} entries={item.data.board.entries}/></div>}
        <div className="history-card-info"><h2>{level ? levelTitle(t, level) : t('Sudoku puzzle')}</h2>
          <p>{[level && t(level.difficulty), pack ? packTitle(t, pack) : level?.pack ? t('Pack') : undefined,
            displayTime(item.data.elapsedMs), date(item) > 0 ? formatDate(new Date(date(item))) : undefined].filter(Boolean).join(' · ')}</p></div>
        {level && <div className="button-bar">
          <PuzzleShare level={level}/>
          <button className="secondary" disabled={!canPlay} onClick={() => replay(level)}>{t("Replay")}</button>
        </div>}
      </li>
    })}</ul>
  </section>
}
