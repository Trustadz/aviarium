import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Download, LockKeyhole, Share2, Shuffle, Timer } from 'lucide-react'
import { difficulties, type Difficulty, type PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { packLevels, packRuleLabels, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { quickPlayVersion } from '../../../packages/sudoku/src/contracts.js'
import { formatSeedCode, parseSeedCode } from '../../../packages/sudoku/src/seed-code.js'
import { errorMessage } from './api.js'
import { SudokuPreview } from './Grid.js'
import { levelKey, type LocalSession } from './storage.js'

const sudokuPath = '/games/sudoku'
export const packPath = (pack: Pick<PublishedPack, 'id' | 'revision'>) => `${sudokuPath}/packs/${pack.id}/${pack.revision}`

export function PuzzleShare({ level }: { level: PublishedLevel }) {
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
  return <><button className="text-button" onClick={() => { void share() }}><Share2 size={16}/> Share seed</button>
    {show && <div className="puzzle-share">
      <input readOnly aria-label="Seed code" value={seed} onFocus={event => event.target.select()}/>
      {navigator.clipboard && <button className="secondary" onClick={() => {
        void navigator.clipboard.writeText(seed).then(() => setCopied(true)).catch(() => undefined)
      }}>{copied ? 'Copied' : 'Copy seed'}</button>}
    </div>}
  </>
}

export function QuickPlay({ online, profile, generate }: {
  online: boolean; profile: string
  generate: (difficulty: Difficulty, seed?: string, version?: number) => Promise<void>
}) {
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
        <h2 id="quick-title">Quick Play</h2>
        <button type="button" className="text-button" aria-expanded={hasSeed} disabled={busy}
          onClick={() => setHasSeed(!hasSeed)}>{hasSeed ? 'Random seed' : 'Enter seed'}</button>
      </div>
      {hasSeed && <label className="quick-seed">Puzzle seed<input maxLength={120} value={seed} required
        onChange={event => setSeed(event.target.value)}/></label>}
      <div className="quick-play-actions">
        <select aria-label="Difficulty" value={selectedDifficulty} disabled={busy || Boolean(seedDifficulty)}
          onChange={event => {
            const next = event.target.value as Difficulty
            setDifficulty(next)
            localStorage.setItem(difficultyKey, next)
          }}>
          {difficulties.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <button type="submit" className="primary" disabled={!online || busy || (hasSeed && (!seed.trim() || (!embedded && seed.trim().length > 100)))}>
          <Shuffle size={17}/>{busy ? 'Preparing puzzle…' : hasSeed ? 'Play seed' : 'New puzzle'}
        </button>
      </div>
      {!online && <p>Connect to start a new Quick Play puzzle.</p>}
      {problem && <p className="error" role="alert">{problem}</p>}
    </form>
  </section>
}

function gradeRange(pack: PublishedPack) {
  const tiers = pack.data.puzzles.map(puzzle => difficulties.indexOf(puzzle.difficulty))
  const min = Math.min(...tiers), max = Math.max(...tiers)
  return min === max ? difficulties[min] : difficulties[min] + '–' + difficulties[max]
}

export function PackCards({ packs, completed, open }: {
  packs: PublishedPack[]; completed: ReadonlySet<string>; open: (pack: PublishedPack) => void
}) {
  return <section className="sudoku-packs" aria-labelledby="packs-title">
    <h2 id="packs-title">Packs</h2>
    {packs.length ? <div className="pack-cards">{packs.map(pack => {
      const levels = packLevels(pack)
      const solved = levels.filter(level => completed.has(levelKey(level.id, level.revision))).length
      return <button className={`pack-card pack-${pack.data.theme}`} key={pack.id} onClick={() => open(pack)}>
        {pack.data.cover && <img className="pack-cover" src={pack.data.cover} alt=""/>}
        <div className="pack-card-copy">
          <span className="pack-card-title">{pack.data.title}<ArrowRight size={18}/></span>
          <span>{gradeRange(pack)} · {solved} of {levels.length} solved</span>
        </div>
      </button>
    })}</div> : <p>No packs available on this device yet.</p>}
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
  const levels = packLevels(pack)
  const solved = levels.map(level => completed.has(levelKey(level.id, level.revision)))
  const next = solved.indexOf(false)
  const art = pack.data.background ?? pack.data.cover
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (/^stop-\d+$/.test(anchor)) document.getElementById(anchor)?.scrollIntoView({ block: 'center' })
  }, [pack.id, pack.revision])
  return <section className={`catalog pack-roadmap pack-${pack.data.theme}`}>
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> Sudoku menu</button>
      {canExport && <a className="text-button" href={`/api/packs/${pack.id}/${pack.revision}/export`} download><Download size={17}/> Export pack</a>}
    </div>
    <header className="pack-banner">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro"><h1>{pack.data.title}</h1>
        {pack.data.description && <p>{pack.data.description}</p>}
        <p>{gradeRange(pack)} · {solved.filter(Boolean).length} of {levels.length} solved</p>
        <ul className="pack-tags">{packRuleLabels(pack.data.rules).map(rule => <li className="badge" key={String(rule)}>{rule}</li>)}</ul>
      </div>
    </header>
    <ol className="pack-trail">
      {levels.map((level, index) => {
        const locked = pack.data.rules.inOrder && index > 0 && !solved[index - 1]
        const saved = sessions.some(item => !item.archived && !item.data.completed && item.data.lives !== 0 &&
          item.data.level === level.id && item.data.levelRevision === level.revision)
        const action = saved ? 'Resume' : solved[index] ? 'Replay' : 'Play'
        const times = pack.data.rules.timeTrial ? sessions.filter(item => item.data.completed && item.data.level === level.id &&
          item.data.levelRevision === level.revision).map(item => item.data.elapsedMs) : []
        return <li id={`stop-${index + 1}`} key={level.id} className={next === index ? 'next-stop' : undefined}>
          <span className="stop-number" aria-hidden="true">{solved[index] ? <Check size={18}/> : index + 1}</span>
          <div><h2>{level.title}</h2>
            <p>{level.difficulty}{locked ? ' · Solve the previous stop to unlock' : solved[index] ? ' · Solved' : next === index ? ' · Up next' : ''}</p>
            {times.length > 0 && <p className="pack-best"><Timer size={14}/> Best {displayTime(Math.min(...times))}</p>}</div>
          <button className="secondary" disabled={!canPlay || locked} onClick={() => play(level)}
            aria-label={action + ' ' + level.title}>
            {locked ? <LockKeyhole size={17}/> : action}
          </button>
        </li>
      })}
    </ol>
  </section>
}

export function SudokuHistory({ sessions, levels, packs, leave, replay, canPlay }: {
  sessions: LocalSession[]; levels: ReadonlyMap<string, PublishedLevel>; packs: PublishedPack[]
  leave: () => void; replay: (level: PublishedLevel) => void; canPlay: boolean
}) {
  const date = (session: LocalSession) => session.data.completedAt ?? session.updated
  const history = sessions.filter(item => item.data.completed).sort((a, b) => date(b) - date(a))
  return <section className="catalog sudoku-history">
    <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> Sudoku menu</button>
    <h1>History</h1>
    {!history.length && <p>No completed puzzles yet.</p>}
    <ul className="history-list">{history.map(item => {
      const level = levels.get(levelKey(item.data.level, item.data.levelRevision))
      const pack = level?.pack && packs.find(pack => pack.id === level.pack?.id && pack.revision === level.pack.revision)
      return <li className="panel history-card" key={item.id}>
        {level && <div className="continue-preview"><SudokuPreview grid={level.grid} entries={item.data.board.entries}/></div>}
        <div className="history-card-info"><h2>{level?.title ?? 'Sudoku puzzle'}</h2>
          <p>{[level?.difficulty, pack?.data.title ?? (level?.pack ? 'Pack' : undefined),
            displayTime(item.data.elapsedMs), date(item) > 0 ? new Date(date(item)).toLocaleDateString() : undefined].filter(Boolean).join(' · ')}</p></div>
        {level && <div className="button-bar">
          <PuzzleShare level={level}/>
          <button className="secondary" disabled={!canPlay} onClick={() => replay(level)}>Replay</button>
        </div>}
      </li>
    })}</ul>
  </section>
}
