import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eraser, Lightbulb, Pause, Pencil, Play, Redo2, RotateCcw, Timer, Undo2 } from 'lucide-react'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import type { Preferences, SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { conflicts, rules } from '../../../packages/sudoku/src/rules.js'
import { analyze, validate } from '../../../packages/sudoku/src/solver.js'
import { Grid } from './Grid.js'
import type { LocalSession } from './storage.js'

export function createSave(level: PublishedLevel): SudokuSave {
  return { game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    board: rules.create(Array.from(level.grid, Number)), undo: [], redo: [], elapsedMs: 0, completed: false }
}

interface Props {
  session: LocalSession; level: PublishedLevel; preferences: Preferences; reader: boolean
  persist: (data: SudokuSave) => Promise<void>; leave: () => void; reset: () => void
}
export default function Player({ session, level, preferences, reader, persist, leave, reset }: Props) {
  const givens = useMemo(() => Array.from(level.grid, Number), [level.grid])
  const [data, setData] = useState(session.data)
  const latest = useRef(data)
  const [selected, select] = useState(Math.max(givens.indexOf(0), 0))
  const [note, setNote] = useState(false)
  const [paused, setPaused] = useState(false)
  const [hint, setHint] = useState('')
  const [problem, setProblem] = useState('')
  const [display, setDisplay] = useState(data.elapsedMs)
  const started = useRef(Date.now())
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

  function move(digit: number, forceValue = false) {
    if (paused || finished) return
    const current = latest.current
    const board = rules.apply(givens, current.board, { cell: selected, digit, note: note && !forceValue })
    if (board === current.board) return
    setHint('')
    void snapshot({ ...current, board, undo: [...current.undo, current.board].slice(-40), redo: [],
      completed: rules.verify(givens, board.entries) })
  }
  function history(direction: 'undo' | 'redo') {
    if (paused || finished) return
    const current = latest.current
    const source = current[direction]
    const board = source.at(-1)
    if (!board) return
    const other = direction === 'undo' ? 'redo' : 'undo'
    void snapshot({ ...current, board, [direction]: source.slice(0, -1), [other]: [...current[other], current.board].slice(-40),
      completed: rules.verify(givens, board.entries) })
  }
  function getHint() {
    const board = latest.current.board.entries
    const bad = conflicts(board)
    if (bad.size) { select([...bad][0]); setHint('Check the highlighted conflict before requesting a hint.'); return }
    const step = analyze(board).steps[0]
    if (step) {
      select(step.cell)
      setHint(`${step.technique}: try ${step.digit} in row ${Math.floor(step.cell / 9) + 1}, column ${step.cell % 9 + 1}.`)
      return
    }
    const result = validate(board, 5_000)
    if (result.kind === 'unsolvable') setHint('The current entries cannot lead to a solution. Try undoing a move.')
    else if ('solution' in result && result.solution) {
      const cell = board.indexOf(0)
      if (cell >= 0) { select(cell); setHint('One possible continuation is ' + result.solution[cell] + ' in the selected cell.') }
    } else setHint('No deduction was found within the hint budget.')
  }
  const seconds = Math.floor(display / 1000)
  return <div className="play-page">
    <button className="text-button back" onClick={() => { void snapshot().then(leave) }}><ArrowLeft size={17}/> Game menu</button>
    <div className="play-heading"><div><div className="eyebrow">SUDOKU</div><h1>{level.title}</h1></div>
      <div className="play-meta"><span className={'badge ' + level.difficulty.toLowerCase()}>{level.difficulty}</span>
        {preferences.timer && !reader && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div></div>
    <div className="play-layout">
      <div className="board-wrap">
        {paused ? <div className="pause-panel"><h2>Game paused</h2><button className="primary" onClick={() => { started.current = Date.now(); setPaused(false) }}><Play size={18}/> Resume game</button></div>
          : <Grid entries={data.board.entries} notes={data.board.notes} givens={givens} selected={selected} select={select}
            enter={move} errors={preferences.mistakes ? conflicts(data.board.entries) : undefined} disabled={finished}/>}
      </div>
      <div className="play-controls">
        {finished ? <section className="panel success"><h2>Puzzle solved</h2><p>Your completion has been saved on this device.</p><button className="primary" onClick={leave}>Choose another puzzle</button></section>
          : <><div className="number-pad" aria-label="Digits">{Array.from({ length: 9 }, (_, index) =>
            <button disabled={paused} key={index} onClick={() => move(index + 1)}>{index + 1}</button>)}</div>
          <div className="tools">
            <button disabled={paused || !data.undo.length} onClick={() => history('undo')}><Undo2 size={18}/> Undo</button>
            <button disabled={paused || !data.redo.length} onClick={() => history('redo')}><Redo2 size={18}/> Redo</button>
            <button disabled={paused} aria-pressed={note} onClick={() => setNote(!note)}><Pencil size={18}/> Notes</button>
            <button disabled={paused} onClick={() => move(0)}><Eraser size={18}/> Erase</button>
            {preferences.hints && <button disabled={paused} onClick={getHint}><Lightbulb size={18}/> Hint</button>}
            <button onClick={() => { if (!paused) void snapshot(); setPaused(!paused) }}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? 'Resume' : 'Pause'}</button>
          </div>
          {hint && <p role="status" className="feedback">{hint}</p>}
          </>}
        <button className="text-button" onClick={() => { if (confirm('Start a fresh attempt? Your current attempt will be archived.')) reset() }}>
          <RotateCcw size={16}/> Reset puzzle
        </button>
        <p role="alert" className="error">{problem}</p>
      </div>
    </div>
  </div>
}
