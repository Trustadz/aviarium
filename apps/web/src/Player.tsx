import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, Eraser, Lightbulb, Pause, Pencil, Play, Redo2, RotateCcw, Settings2, Timer, Undo2 } from 'lucide-react'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import type { Preferences, SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { candidateMasks, column, conflicts, row, rules, type Board } from '../../../packages/sudoku/src/rules.js'
import { analyze, validate } from '../../../packages/sudoku/src/solver.js'
import { Grid } from './Grid.js'
import type { LocalSession } from './storage.js'

export function createSave(level: PublishedLevel): SudokuSave {
  return { game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    board: rules.create(Array.from(level.grid, Number)), undo: [], redo: [], elapsedMs: 0, completed: false }
}

interface Props {
  session: LocalSession; level: PublishedLevel; preferences: Preferences; reader: boolean
  persist: (data: SudokuSave) => Promise<void>; leave: () => void; reset: () => void; openSettings: () => void
}
type Hint = { text: string; cell?: number } & ({ stage: 1 | 2 | 3; digit: number; cell: number } | { stage?: never })

function digitUsedUp(entries: readonly number[], digit: number) {
  return entries.filter(value => value === digit).length >= 9
}

export default function Player({ session, level, preferences, reader, persist, leave, reset, openSettings }: Props) {
  const givens = useMemo(() => Array.from(level.grid, Number), [level.grid])
  const [data, setData] = useState(session.data)
  const latest = useRef(data)
  const [selected, select] = useState(Math.max(givens.indexOf(0), 0))
  const [note, setNote] = useState(false)
  const [lockedDigit, setLockedDigit] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hint, setHint] = useState<Hint>()
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
    const elapsedMs = paused || latest.current.completed ? latest.current.elapsedMs
      : latest.current.elapsedMs + Math.max(0, now - started.current)
    started.current = now
    setDisplay(elapsedMs)
    return commit({ ...next, elapsedMs })
  }
  const finished = data.completed
  useEffect(() => {
    if (paused || finished) return
    started.current = Date.now()
    const timer = setInterval(() => {
      if (preferences.timer && !reader) setDisplay(latest.current.elapsedMs + Date.now() - started.current)
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
  }, [paused, finished, preferences.timer, reader])

  function saveBoard(board: Board) {
    const current = latest.current
    if (board === current.board) return
    if (board.entries !== current.board.entries) setHint(undefined)
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    void snapshot({ ...current, board, undo: [...current.undo, current.board].slice(-40), redo: [],
      completed: rules.verify(givens, board.entries) })
  }
  function move(digit: number, cell = selected) {
    if (paused || finished) return
    const board = latest.current.board
    if (digit && !note && digitUsedUp(board.entries, digit)) return
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
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    const other = direction === 'undo' ? 'redo' : 'undo'
    void snapshot({ ...current, board, [direction]: source.slice(0, -1), [other]: [...current[other], current.board].slice(-40),
      completed: rules.verify(givens, board.entries) })
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
    const step = analyze(board).steps[0]
    if (step) {
      const text = step.technique === 'Hidden single'
        ? `Look for a hidden single. Find a digit that can fit in only one empty cell in a ${step.unit}.`
        : 'Look for a naked single. Find an empty cell where the digits in its row, column, and box leave only one candidate.'
      setHint({ ...step, text, stage: 1 })
    } else if ('solution' in result && result.solution) {
      const cell = board.indexOf(0)
      setHint({ cell, digit: result.solution[cell], stage: 1,
        text: 'Try testing a candidate. Follow what it forces elsewhere, and rule it out if it leads to a contradiction.' })
    } else setHint({ text: 'No deduction was found within the hint budget.' })
  }
  const visibleHint = preferences.hints && !paused ? hint : undefined
  const hintCell = visibleHint?.stage === 1 ? undefined : visibleHint?.cell
  const hintText = visibleHint?.stage === 3
    ? `${visibleHint.text} Try ${visibleHint.digit} in row ${row(visibleHint.cell) + 1}, column ${column(visibleHint.cell) + 1}.`
    : visibleHint?.stage === 2
      ? `${visibleHint.text} Look at row ${row(visibleHint.cell) + 1}, column ${column(visibleHint.cell) + 1}.`
      : visibleHint?.text
  const seconds = Math.floor(display / 1000)
  return <div className="play-page">
    <div className="play-navigation">
      <button className="text-button back" onClick={() => { void snapshot().then(leave) }}><ArrowLeft size={17}/> Game menu</button>
      <button className="icon-button" title="Sudoku settings" aria-label="Sudoku settings" onClick={openSettings}><Settings2 size={18}/></button>
    </div>
    <div className="play-heading"><div><div className="eyebrow">SUDOKU</div><h1>{level.title}</h1></div>
      <div className="play-meta"><span className={'badge ' + level.difficulty.toLowerCase()}>{level.difficulty}</span>
        {preferences.timer && !reader && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div></div>
    <div className="play-layout">
      <div className="board-wrap">
        {paused ? <div className="pause-panel"><h2>Game paused</h2><button className="primary" onClick={() => { started.current = Date.now(); setPaused(false) }}><Play size={18}/> Resume game</button></div>
          : <Grid entries={data.board.entries} notes={data.board.notes} givens={givens} selected={selected} select={select}
            enter={move} activate={cell => { select(cell); if (lockedDigit) move(lockedDigit, cell) }}
            highlightedDigit={lockedDigit || data.board.entries[selected]} hintCell={hintCell}
            errors={preferences.mistakes ? conflicts(data.board.entries) : undefined} disabled={finished}/>}
      </div>
      <div className="play-controls">
        {finished ? <section className="panel success"><h2>Puzzle solved</h2><p>Your completion has been saved on this device.</p><button className="primary" onClick={leave}>Choose another puzzle</button></section>
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
            {preferences.autoNotes && <button disabled={paused} onClick={autoNotes}><Pencil size={18}/> Auto notes</button>}
            <button disabled={paused} onClick={() => { setLockedDigit(0); move(0) }}><Eraser size={18}/> Erase</button>
            {preferences.hints && <button disabled={paused} onClick={getHint}><Lightbulb size={18}/> Hint</button>}
            <button onClick={() => { if (!paused) void snapshot(); setPaused(!paused) }}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? 'Resume' : 'Pause'}</button>
          </div>
          {hintText && <p role="status" className="feedback">{hintText}{visibleHint?.stage === 1 ? ' Press Hint again to highlight the cell.'
            : visibleHint?.stage === 2 ? ' Press Hint again to reveal the digit.' : ''}</p>}
          </>}
        <button className="text-button" onClick={() => { if (confirm('Start a fresh attempt? Your current attempt will be archived.')) reset() }}>
          <RotateCcw size={16}/> Reset puzzle
        </button>
        <p role="alert" className="error">{problem}</p>
      </div>
    </div>
  </div>
}
