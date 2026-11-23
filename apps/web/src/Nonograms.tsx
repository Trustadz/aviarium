import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowLeft, RotateCcw, Settings2, Timer, Undo2 } from 'lucide-react'
import { type NonogramLevel, type NonogramPack, type NonogramSave } from '../../../packages/nonograms/src/contracts.js'
import { fillsFitClues, matchesClues, type Cell } from '../../../packages/nonograms/src/puzzles.js'
import type { GamePlayerProps } from './game-web.js'
import { knownMessage, useT } from './i18n.js'
import { errorMessage } from './api.js'
import './nonograms.css'

export default function Nonograms({ level, pack, session, preferences, leave, persist, reset, openSettings, reader, trial = false }: GamePlayerProps & { trial?: boolean }) {
  const t = useT()
  const [saved, setSaved] = useState(() => session.data as NonogramSave)
  const started = useRef(Date.now())
  const [problem, setProblem] = useState('')
  const puzzle = (level as NonogramLevel).content
  const previous = useRef(saved)
  const version = useRef(0)
  const persistRef = useRef(persist)
  persistRef.current = persist
  const [display, setDisplay] = useState(saved.elapsedMs)
  const showTimer = preferences.nonogramTimer !== false && !reader
  const title = pack?.builtIn || level.source === 'Generated' ? knownMessage(t, level.title) : level.title

  function takeElapsed() {
    const now = Date.now()
    const elapsed = Math.min(365 * 86400_000,
      previous.current.elapsedMs + Math.max(0, now - started.current))
    started.current = now
    return elapsed
  }

  function commit(next: NonogramSave) {
    previous.current = next
    setSaved(next)
    setDisplay(next.elapsedMs)
    const attempt = ++version.current
    return persistRef.current(next).then(
      () => { if (attempt === version.current) setProblem('') },
      error => { if (attempt === version.current) setProblem(errorMessage(error)) },
    )
  }

  function onMove(board: Cell[], undo: Cell[][]) {
    const completed = matchesClues(puzzle, board)
    void commit({ ...previous.current, board, undo, completed, elapsedMs: takeElapsed(),
      completedAt: completed ? Date.now() : undefined })
  }

  // Save the running clock when leaving the puzzle, as Sudoku does, so the
  // last few seconds are not lost between checkpoints.
  function exit() {
    if (!previous.current.completed) void commit({ ...previous.current, elapsedMs: takeElapsed() })
    leave()
  }

  useEffect(() => {
    if (saved.completed) return
    const tick = showTimer ? setInterval(() => {
      if (document.hidden || previous.current.completed) return
      setDisplay(Math.min(365 * 86400_000,
        previous.current.elapsedMs + Math.max(0, Date.now() - started.current)))
    }, 1000) : undefined
    const checkpoint = setInterval(() => {
      if (!document.hidden && !previous.current.completed)
        void commit({ ...previous.current, elapsedMs: takeElapsed() })
    }, 5000)
    function visibility() {
      if (previous.current.completed) return
      if (!document.hidden) { started.current = Date.now(); return }
      void commit({ ...previous.current, elapsedMs: takeElapsed() })
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      if (tick) clearInterval(tick)
      clearInterval(checkpoint)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [saved.completed, showTimer])

  return <PuzzleBoard puzzle={puzzle} title={title} pack={pack as NonogramPack | undefined}
    leave={exit} reset={reset} openSettings={openSettings} committed={saved.board} undo={saved.undo}
    problem={problem} trial={trial} elapsedMs={display} showTimer={showTimer} onMove={onMove}/>
}

function markValue(current: Cell, tool: Cell, value: Cell) {
  const protectedMark = tool !== 0 && current !== 0 && current !== tool
  return protectedMark ? current : value
}

function PuzzleBoard({ puzzle, title, pack, leave, reset, openSettings, committed, undo, problem, trial, elapsedMs, showTimer, onMove }: {
  puzzle: NonogramLevel['content']
  title: string
  pack?: NonogramPack
  leave: () => void
  reset: () => void
  openSettings?: () => void
  committed: Cell[]
  undo: Cell[][]
  problem: string
  trial: boolean
  elapsedMs: number
  showTimer: boolean
  onMove: (cells: Cell[], undo: Cell[][]) => void
}) {
  const t = useT()
  const width = puzzle.columns.length
  const height = puzzle.rows.length
  const [painted, setPainted] = useState<Cell[]>()
  const cells = painted ?? committed
  const rowConflicts = puzzle.rows.map((runs, row) =>
    !fillsFitClues(cells.slice(row * width, (row + 1) * width), runs))
  const columnConflicts = puzzle.columns.map((runs, column) =>
    !fillsFitClues(puzzle.rows.map((_, row) => cells[row * width + column]), runs))
  const solved = matchesClues(puzzle, committed)
  const seconds = Math.floor(elapsedMs / 1000)
  const [mode, setMode] = useState<Cell>(1)
  const [focus, setFocus] = useState(0)
  const squares = useRef<(HTMLButtonElement | null)[]>([])

  const stroke = useRef<{
    id: number; tool: Cell; value: Cell; next: Cell[]; x: number; y: number; step: number
  } | null>(null)

  function startStroke(event: PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cell]')
    if (solved || event.button !== 0 || !event.isPrimary || stroke.current || !cell) return
    const index = Number(cell.dataset.cell)
    const value = cells[index] === mode ? 0 : mode
    const next = [...cells]
    next[index] = markValue(cells[index], mode, value)
    const { width, height } = cell.getBoundingClientRect()
    stroke.current = { id: event.pointerId, tool: mode, value, next, x: event.clientX, y: event.clientY,
      step: Math.min(width, height) / 2 }
    cell.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    setPainted(next)
  }

  function paint(event: PointerEvent<HTMLDivElement>) {
    const active = stroke.current
    if (!active || active.id !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    const intervals = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, active.step)))
    let next = active.next
    // Sample between pointer events so a fast stroke still reaches intermediate squares.
    for (let step = 1; step <= intervals; step++) {
      const cell = document.elementFromPoint(active.x + dx * step / intervals, active.y + dy * step / intervals)
        ?.closest<HTMLButtonElement>('[data-cell]')
      if (!cell || !event.currentTarget.contains(cell)) continue
      const index = Number(cell.dataset.cell)
      const value = markValue(next[index], active.tool, active.value)
      if (next[index] === value) continue
      if (next === active.next) next = [...next]
      next[index] = value
    }
    active.x = event.clientX
    active.y = event.clientY
    if (active.next !== next) {
      active.next = next
      setPainted(next)
    }
  }

  function endStroke(event: PointerEvent<HTMLDivElement>) {
    if (event.type === 'pointerup') paint(event)
    const active = stroke.current
    if (!active || active.id !== event.pointerId) return
    stroke.current = null
    setPainted(undefined)
    if (active.next.some((value, index) => value !== committed[index])) {
      onMove(active.next, [...undo.slice(-99), committed])
    }
  }

  function move(index: number, mark: Cell) {
    const value = markValue(cells[index], mark, cells[index] === mark ? 0 : mark)
    if (solved || stroke.current || cells[index] === value) return
    const next = [...cells]
    next[index] = value
    onMove(next, [...undo.slice(-99), cells])
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / width)
    const column = index % width
    const directions: Record<string, number> = {
      ArrowUp: Math.max(0, row - 1) * width + column,
      ArrowDown: Math.min(height - 1, row + 1) * width + column,
      ArrowLeft: row * width + Math.max(0, column - 1),
      ArrowRight: row * width + Math.min(width - 1, column + 1),
    }
    if (Object.hasOwn(directions, event.key)) {
      event.preventDefault()
      squares.current[directions[event.key]]?.focus()
    } else if (['x', 'X', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault()
      move(index, event.key.toLowerCase() === 'x' ? 2 : 0)
    }
  }

  const art = pack?.data.background ?? pack?.data.cover
  return <section className={pack ? 'play-page nonogram-play pack-play pack-' + pack.data.theme : 'play-page nonogram-play'}
    aria-labelledby="nonogram-puzzle-title">
    {art && <img className="pack-play-art" src={art} alt=""/>}
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t(trial ? 'Back to editor' : 'Game menu')}</button>
      {openSettings && <button className="icon-button" title={t('Nonogram settings')} aria-label={t('Nonogram settings')} onClick={openSettings}><Settings2 size={18}/></button>}
    </div>
    <div className="play-heading">
      <div><div className="eyebrow">{pack ? (pack.builtIn ? knownMessage(t, pack.data.title) : pack.data.title) : 'Nonograms'}</div><h1 id="nonogram-puzzle-title">{title}</h1></div>
      <div className="play-meta"><span className="badge">{height} × {width}</span>
        {showTimer && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div>
    </div>
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    <div className="play-layout">
      <div className="nonogram-board" data-solved={solved} data-size={width} style={{
        '--columns': width,
        '--row-clues': Math.max(...puzzle.rows.map(clue => clue.length)),
      } as CSSProperties}>
        <div className="nonogram-column-clues" aria-hidden="true">
          {puzzle.columns.map((runs, column) => <div key={column} data-conflict={columnConflicts[column]}>{runs.map((run, index) => <span key={index}>{run}</span>)}</div>)}
        </div>
        <div className="nonogram-cells" role="group" aria-label={t('Puzzle grid')}
          onPointerDown={startStroke} onPointerMove={paint} onPointerUp={endStroke}
          onPointerCancel={endStroke} onLostPointerCapture={endStroke}>
          {puzzle.rows.map((runs, row) => <div className="nonogram-row" key={row} role="group"
            aria-label={t('Row {row}, clues {clues}', { row: row + 1, clues: runs.join(', ') })}>
            <div className="nonogram-row-clue" data-conflict={rowConflicts[row]} aria-hidden="true">{runs.join(' ')}</div>
            {puzzle.columns.map((columnRuns, column) => {
              const index = row * width + column
              const state = cells[index]
              return <button key={column} className="nonogram-cell"
                ref={element => { squares.current[index] = element }}
                type="button" tabIndex={focus === index ? 0 : -1} data-mark={state} data-cell={index}
                aria-disabled={solved}
                aria-description={[
                  rowConflicts[row] && t('Filled squares conflict with the row clues.'),
                  columnConflicts[column] && t('Filled squares conflict with the column clues.'),
                ].filter(Boolean).join(' ') || undefined}
                aria-label={t('Column {column}, clues {clues}, {mark}', {
                  column: column + 1, clues: columnRuns.join(', '),
                  mark: t(state === 1 ? 'filled' : state === 2 ? 'marked blank' : 'unmarked'),
                })}
                onFocus={() => setFocus(index)}
                onClick={event => { if (event.detail === 0) move(index, mode) }}
                onContextMenu={event => { event.preventDefault(); move(index, 2) }}
                onKeyDown={event => keyboard(event, index)}>
                {state === 2 && !solved && <span aria-hidden="true">×</span>}
              </button>
            })}
          </div>)}
        </div>
      </div>
      <div className="play-controls">
        {solved && <section className="panel success" role="status">
          <h2>{t('Puzzle solved')}</h2>
          {!trial && !problem && <p>{t('Your completion has been saved.')}</p>}
          <button className="primary" onClick={leave}>{t(trial ? 'Back to editor' : pack ? 'Back to roadmap' : 'Choose another puzzle')}</button>
        </section>}
        <div className="tools nonogram-tools" role="group" aria-label={t('Mark squares')}>
          {([['Fill', '■', 1], ['Mark blank', '×', 2], ['Erase', '□', 0]] as const).map(([label, symbol, mark]) =>
            <button key={mark} aria-pressed={mode === mark} disabled={solved} onClick={() => setMode(mark)}>
              <span aria-hidden="true">{symbol}</span> {t(label)}
            </button>)}
          <button disabled={solved || !undo.length} onClick={() => onMove(undo[undo.length - 1], undo.slice(0, -1))}><Undo2 size={18}/> {t('Undo')}</button>
        </div>
        {!trial && !solved && <button className="text-button" onClick={() => {
          if (confirm(t('Start over? Your current saved game will be deleted.'))) reset()
        }}><RotateCcw size={16}/> {t('Reset puzzle')}</button>}
      </div>
    </div>
  </section>
}
