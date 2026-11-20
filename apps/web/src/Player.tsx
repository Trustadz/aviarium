import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, Eraser, Heart, Lightbulb, Pause, Pencil, Play, Redo2, RotateCcw, Settings2, Timer, Undo2 } from 'lucide-react'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import type { Preferences, SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { bit, candidateMasks, column, conflicts, row, rules, type Board } from '../../../packages/sudoku/src/rules.js'
import { logicalHint, type LogicalStep } from '../../../packages/sudoku/src/logic.js'
import type { PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { validate } from '../../../packages/sudoku/src/solver.js'
import { Grid } from './Grid.js'
import { PuzzleShare } from './SudokuMenu.js'
import type { LocalSession } from './storage.js'

export function createSave(level: PublishedLevel, pack?: PublishedPack): SudokuSave {
  return { game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    board: rules.create(Array.from(level.grid, Number)), undo: [], redo: [], elapsedMs: 0, completed: false,
    lives: pack?.data.rules.lives ?? undefined }
}

interface Props {
  session: LocalSession; level: PublishedLevel; preferences: Preferences; reader: boolean; pack?: PublishedPack
  persist: (data: SudokuSave) => Promise<void>; leave: () => void; reset: () => void; openSettings: () => void
}
type Hint = { text: string; cell?: number } & ({ stage: 1 | 2 | 3; step: LogicalStep } | { stage?: never })

function digitUsedUp(entries: readonly number[], digit: number) {
  return entries.filter(value => value === digit).length >= 9
}

export default function Player({ session, level, preferences, reader, pack, persist, leave, reset, openSettings }: Props) {
  const givens = useMemo(() => Array.from(level.grid, Number), [level.grid])
  const lifeLimit = pack?.data.rules.lives
  const showHints = preferences.hints && pack?.data.rules.hints !== false
  const showAutoNotes = preferences.autoNotes && pack?.data.rules.autoNotes !== false
  const showTimer = pack?.data.rules.timeTrial || (preferences.timer && !reader)
  const solution = useMemo(() => {
    if (!lifeLimit) return undefined
    const result = validate(givens, 65_000)
    return result.kind === 'unique' ? result.solution : undefined
  }, [givens, lifeLimit])
  const [data, setData] = useState(session.data)
  const latest = useRef(data)
  const [selected, select] = useState(Math.max(givens.indexOf(0), 0))
  const [note, setNote] = useState(false)
  const [lockedDigit, setLockedDigit] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hint, setHint] = useState<Hint>()
  const excluded = useRef<number[]>([])
  const [moveMessage, setMoveMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [display, setDisplay] = useState(data.elapsedMs)
  const started = useRef(Date.now())
  const press = useRef<{ pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; skipClick: boolean } | null>(null)
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer) }, [])
  const persistRef = useRef(persist)
  persistRef.current = persist
  function commit(next: SudokuSave) {
    latest.current = next
    setData(next)
    return persistRef.current(next).then(() => setProblem(''), error => setProblem('Save failed. ' + String(error.message ?? error)))
  }
  function snapshot(next = latest.current) {
    const now = Date.now()
    const elapsedMs = paused || latest.current.completed || latest.current.lives === 0 ? latest.current.elapsedMs
      : latest.current.elapsedMs + Math.max(0, now - started.current)
    started.current = now
    setDisplay(elapsedMs)
    return commit({ ...next, elapsedMs })
  }
  const gameOver = data.lives === 0
  const finished = data.completed || gameOver
  useEffect(() => {
    if (paused || finished) return
    started.current = Date.now()
    const timer = setInterval(() => {
      if (showTimer) setDisplay(latest.current.elapsedMs + Date.now() - started.current)
    }, 1000)
    const checkpoint = setInterval(() => {
      const now = Date.now()
      const updated = { ...latest.current, elapsedMs: latest.current.elapsedMs + now - started.current }
      started.current = now
      latest.current = updated
      void persistRef.current(updated).catch(error => setProblem('Save failed. ' + error.message))
    }, 5000)
    const pauseHidden = () => {
      if (!document.hidden) return
      const now = Date.now()
      const updated = { ...latest.current, elapsedMs: latest.current.elapsedMs + now - started.current }
      started.current = now
      latest.current = updated
      setData(updated)
      setDisplay(updated.elapsedMs)
      setPaused(true)
      void persistRef.current(updated).catch(error => setProblem('Save failed. ' + error.message))
    }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => { clearInterval(timer); clearInterval(checkpoint); document.removeEventListener('visibilitychange', pauseHidden) }
  }, [paused, finished, showTimer])

  function saveBoard(board: Board) {
    const current = latest.current
    if (board === current.board) return
    if (board.entries !== current.board.entries) {
      excluded.current = []
      setHint(undefined)
      setMoveMessage('')
    }
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    const completed = rules.verify(givens, board.entries)
    void snapshot({ ...current, board, undo: [...current.undo, current.board].slice(-40), redo: [],
      completed, completedAt: completed ? Date.now() : undefined })
  }
  function move(digit: number, cell = selected) {
    const current = latest.current
    if (paused || finished || current.completed || current.lives === 0 || givens[cell]) return
    const board = current.board
    if (digit && !note && digitUsedUp(board.entries, digit)) return
    if (digit && !note && current.lives !== undefined && solution && digit !== solution[cell]) {
      const lives = current.lives - 1
      setMoveMessage(lives ? `Wrong digit. ${lives} ${lives === 1 ? 'life' : 'lives'} left.` : '')
      void snapshot({ ...current, lives })
      return
    }
    saveBoard(rules.apply(givens, board, { cell, digit, note, autoNoteDeletion: preferences.autoNoteDeletion }))
  }
  function autoNotes() {
    const board = latest.current.board
    const notes = candidateMasks(board.entries)
    if (notes.some((mask, cell) => mask !== board.notes[cell])) saveBoard({ ...board, notes })
  }
  function startPress(event: PointerEvent<HTMLButtonElement>, digit: number) {
    if (!event.isPrimary || event.button !== 0) return
    if (press.current) clearTimeout(press.current.timer)
    const gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, skipClick: false,
      timer: setTimeout(() => { gesture.skipClick = true; setLockedDigit(digit) }, 450) }
    press.current = gesture
  }
  function stopPress(event: PointerEvent<HTMLButtonElement>) {
    if (press.current?.pointer === event.pointerId) clearTimeout(press.current.timer)
  }
  function movePress(event: PointerEvent<HTMLButtonElement>) {
    const gesture = press.current
    if (gesture?.pointer === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12) {
      gesture.skipClick = true
      stopPress(event)
    }
  }
  function history(direction: 'undo' | 'redo') {
    if (paused || finished) return
    const current = latest.current
    const source = current[direction]
    const board = source.at(-1)
    if (!board) return
    setHint(undefined)
    excluded.current = []
    setMoveMessage('')
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    const other = direction === 'undo' ? 'redo' : 'undo'
    const completed = rules.verify(givens, board.entries)
    void snapshot({ ...current, board, [direction]: source.slice(0, -1), [other]: [...current[other], current.board].slice(-40),
      completed, completedAt: completed ? Date.now() : undefined })
  }
  function getHint() {
    if (hint?.stage) {
      if (hint.stage < 3) setHint({ ...hint, stage: hint.stage === 1 ? 2 : 3 })
      return
    }
    const board = latest.current.board.entries
    const bad = conflicts(board)
    if (bad.size) {
      setHint({ text: 'Check the highlighted conflict before requesting a hint.', cell: [...bad][0] })
      return
    }
    const result = validate(board, 5_000)
    if (result.kind === 'unsolvable') {
      setHint({ text: 'The current entries cannot lead to a solution. Try undoing a move.' })
      return
    }
    const step = logicalHint(board, excluded.current)
    if (step) {
      const explanation = step.id === 'hidden-single' ? 'Find a digit that can fit in only one cell of a row, column, or box.'
        : step.id === 'naked-single' || step.id === 'open-singles' ? 'Find an empty cell with just one possible digit.'
          : step.type === 'elimination' ? 'Find the pattern to identify which candidates it rules out.' : ''
      setHint({ step, text: `Try the ${step.label.toLowerCase()} technique.${explanation ? ' ' + explanation : ''}`, stage: 1 })
    } else setHint({ text: 'No supported logical deduction was found for this board.' })
  }
  function applyEliminations(step: LogicalStep) {
    const board = latest.current.board
    const notes = [...board.notes]
    for (const { index, eliminatedCandidate } of step.updates) if (eliminatedCandidate) {
      excluded.current[index] = (excluded.current[index] ?? 0) | bit(eliminatedCandidate)
      notes[index] &= ~bit(eliminatedCandidate)
    }
    if (notes.some((mask, cell) => mask !== board.notes[cell])) saveBoard({ ...board, notes })
    setHint(undefined)
  }
  const visibleHint = showHints && !paused ? hint : undefined
  const hintCells = visibleHint?.stage && visibleHint.stage > 1
    ? new Set([...(visibleHint.step.patternCells ?? []), ...visibleHint.step.updates.map(update => update.index)]) : undefined
  const cellText = (index: number) => `row ${row(index) + 1}, column ${column(index) + 1}`
  const hintText = visibleHint?.stage === 3
    ? visibleHint.step.updates.map(({ index, filledValue, eliminatedCandidate }) => filledValue
      ? `Place ${filledValue} in ${cellText(index)}.` : `Eliminate ${eliminatedCandidate} from ${cellText(index)}.`).join(' ')
    : visibleHint?.stage === 2
      ? `${visibleHint.text} Look at the highlighted ${hintCells?.size === 1 ? 'cell' : 'cells'}.`
      : visibleHint?.text
  const seconds = Math.floor(display / 1000)
  const packArt = pack?.data.background ?? pack?.data.cover
  return <div className={pack ? `play-page pack-play pack-${pack.data.theme}` : 'play-page'}>
    {packArt && <img className="pack-play-art" alt="" src={packArt}/>}
    <div className="game-navigation">
      <button className="text-button back" onClick={() => { void snapshot().then(leave) }}><ArrowLeft size={17}/> Game menu</button>
      <button className="icon-button" title="Sudoku settings" aria-label="Sudoku settings" onClick={openSettings}><Settings2 size={18}/></button>
    </div>
    <div className="play-heading"><div><div className="eyebrow">{pack?.data.title ?? 'Sudoku'}</div><h1>{level.title}</h1></div>
      <div className="play-meta"><span className={'badge ' + level.difficulty.toLowerCase()}>{level.difficulty}</span>
        {data.lives !== undefined && <span className="clock" aria-label={`${data.lives} lives remaining`}><Heart size={16}/>{data.lives}/{lifeLimit}</span>}
        {showTimer && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div></div>
    <div className="play-layout">
      <div className="board-wrap">
        {paused ? <div className="pause-panel"><h2>Game paused</h2><button className="primary" onClick={() => { started.current = Date.now(); setPaused(false) }}><Play size={18}/> Resume game</button></div>
          : <Grid entries={data.board.entries} notes={data.board.notes} givens={givens} selected={selected} select={select}
            enter={move} activate={cell => { select(cell); if (lockedDigit) move(lockedDigit, cell) }}
            highlightedDigit={lockedDigit || data.board.entries[selected]} hintCell={visibleHint?.cell} hintCells={hintCells}
            errors={preferences.mistakes ? conflicts(data.board.entries) : undefined} disabled={finished}/>}
      </div>
      <div className="play-controls">
        {finished ? <section className="panel success">
          <h2>{gameOver ? 'Out of lives' : 'Puzzle solved'}</h2>
          <p>{gameOver ? 'Start a fresh attempt to try this stop again.' : 'Your completion has been saved.'}</p>
          <button className="primary" onClick={gameOver ? reset : leave}>{gameOver ? 'Retry puzzle' : pack ? 'Back to roadmap' : 'Choose another puzzle'}</button>
          {!gameOver && <PuzzleShare level={level}/>}
        </section>
          : <><div className="number-pad" aria-label="Digits">{Array.from({ length: 9 }, (_, index) => {
            const digit = index + 1
            return <button key={digit} disabled={paused || (!note && digitUsedUp(data.board.entries, digit))}
              aria-pressed={lockedDigit === digit} onPointerDown={event => startPress(event, digit)}
              onPointerUp={stopPress} onPointerCancel={stopPress} onPointerLeave={stopPress} onPointerMove={movePress}
              onContextMenu={event => event.preventDefault()} onClick={event => {
                const skipClick = event.detail > 0 && press.current?.skipClick
                if (press.current) clearTimeout(press.current.timer)
                press.current = null
                if (skipClick) return
                setLockedDigit(0)
                if (lockedDigit !== digit) move(digit)
              }}>{digit}</button>
          })}</div>
          <div className="tools">
            <button disabled={paused || !data.undo.length} onClick={() => history('undo')}><Undo2 size={18}/> Undo</button>
            <button disabled={paused || !data.redo.length} onClick={() => history('redo')}><Redo2 size={18}/> Redo</button>
            <button disabled={paused} aria-pressed={note} onClick={() => {
              if (note && lockedDigit && digitUsedUp(data.board.entries, lockedDigit)) setLockedDigit(0)
              setNote(!note)
            }}><Pencil size={18}/> Notes</button>
            {showAutoNotes && <button disabled={paused} onClick={autoNotes}><Pencil size={18}/> Auto notes</button>}
            <button disabled={paused} onClick={() => { setLockedDigit(0); move(0) }}><Eraser size={18}/> Erase</button>
            {showHints && <button disabled={paused} onClick={getHint}><Lightbulb size={18}/> Hint</button>}
            <button onClick={() => { if (!paused) void snapshot(); setPaused(!paused) }}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? 'Resume' : 'Pause'}</button>
          </div>
          {hintText && <p role="status" className="feedback">{hintText}{visibleHint?.stage === 1 ? ' Press Hint again to highlight the cell.'
            : visibleHint?.stage === 2 ? ' Press Hint again to reveal the deduction.' : ''}</p>}
          {visibleHint?.stage === 3 && visibleHint.step.type === 'elimination' && <button className="secondary"
            onClick={() => applyEliminations(visibleHint.step)}>Apply deduction</button>}
          {moveMessage && <p role="status" className="error">{moveMessage}</p>}
          {!pack && level.seed && <PuzzleShare level={level}/>}
          </>}
        {!gameOver && <button className="text-button" onClick={() => { if (confirm('Start over? Your current saved game will be deleted.')) reset() }}>
          <RotateCcw size={16}/> Reset puzzle
        </button>}
        <p role="alert" className="error">{problem}</p>
      </div>
    </div>
  </div>
}
