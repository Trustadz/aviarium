import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArrowLeft, BookOpen, Shuffle, Undo2 } from 'lucide-react'
import { z } from 'zod'
import { matchesClues, randomPuzzle, starterPuzzles, type Cell, type Puzzle } from '../../../packages/nonograms/src/puzzles.js'
import { useT } from './i18n.js'
import './nonograms.css'

const marks = z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).max(100)
const line = z.array(z.number().int().min(0).max(10)).min(1).max(5)
const savedGame = z.object({
  selected: z.string().optional(),
  boards: z.record(z.string(), marks),
  random: z.object({ rows: z.array(line).length(10), columns: z.array(line).length(10) }).optional(),
})
type SavedGame = z.infer<typeof savedGame>

function readGame(key: string): SavedGame {
  try { return savedGame.parse(JSON.parse(localStorage.getItem(key) ?? 'null')) }
  catch { return { boards: {} } }
}

export default function Nonograms({ profile, leave, guide, onActivity }: {
  profile: string
  leave: () => void
  guide: () => void
  onActivity: () => void
}) {
  const t = useT()
  const key = 'aviarium:nonograms:v1:' + profile
  const [saved, setSaved] = useState(() => readGame(key))
  const [error, setError] = useState('')
  const starter = starterPuzzles.find(item => item.id === saved.selected)
  const puzzle = saved.selected === 'random' ? saved.random : starter?.puzzle
  const selected = puzzle ? saved.selected : undefined
  const currentRandom = saved.boards.random
  const keepRandom = saved.random && (!currentRandom || !matchesClues(saved.random, currentRandom))

  function save(next: SavedGame) {
    setSaved(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setError('')
    } catch {
      setError(t('Progress could not be saved on this device.'))
    }
  }

  function select(id: string) {
    onActivity()
    save({ ...saved, selected: id })
  }

  function newRandom() {
    if (keepRandom && currentRandom?.some(Boolean) && !window.confirm(t('Replace your unfinished random puzzle?'))) return
    const random = randomPuzzle()
    if (!random) {
      setError(t('No random puzzle found. Try again.'))
      return
    }
    onActivity()
    save({ ...saved, selected: 'random', boards: { ...saved.boards, random: [] }, random })
  }

  return <section className="catalog nonograms" aria-labelledby="nonograms-title">
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t('Library')}</button>
      <button className="text-button" onClick={guide}><BookOpen size={17}/> {t('How to play')}</button>
    </div>
    <h1 id="nonograms-title">Nonograms</h1>
    <div className="nonogram-picker" aria-label={t('Choose a puzzle')} role="group">
      {starterPuzzles.map(({ id, title, puzzle }) => <button key={id} className="secondary"
        aria-pressed={selected === id} onClick={() => select(id)}>
        {t(title)} <small>{puzzle.rows.length} × {puzzle.columns.length}</small>
      </button>)}
      {keepRandom && selected !== 'random' && <button className="secondary" onClick={() => select('random')}>
        {t('Resume random puzzle')}
      </button>}
      <button className="primary" onClick={newRandom}><Shuffle size={17}/> {t('Random puzzle')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {puzzle && selected && <PuzzleBoard key={selected + JSON.stringify(puzzle)} puzzle={puzzle}
      title={starter?.title ?? 'Random puzzle'} savedCells={saved.boards[selected]}
      onMove={cells => {
        onActivity()
        save({ ...saved, boards: { ...saved.boards, [selected]: cells } })
      }}/>}
  </section>
}

function PuzzleBoard({ puzzle, title, savedCells, onMove }: {
  puzzle: Puzzle
  title: (typeof starterPuzzles)[number]['title'] | 'Random puzzle'
  savedCells?: Cell[]
  onMove: (cells: Cell[]) => void
}) {
  const t = useT()
  const width = puzzle.columns.length
  const height = puzzle.rows.length
  const cells: Cell[] = savedCells?.length === width * height ? savedCells : Array(width * height).fill(0)
  const solved = matchesClues(puzzle, cells)
  const [mode, setMode] = useState<Cell>(1)
  const [focus, setFocus] = useState(0)
  const [undo, setUndo] = useState<Cell[][]>([])
  const squares = useRef<(HTMLButtonElement | null)[]>([])

  function move(index: number, mark: Cell) {
    const value = cells[index] === mark ? 0 : mark
    if (solved || cells[index] === value) return
    const next = [...cells]
    next[index] = value
    setUndo(previous => [...previous.slice(-99), cells])
    onMove(next)
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

  return <section className="nonogram-play" aria-labelledby="nonogram-puzzle-title">
    <h2 id="nonogram-puzzle-title">{t(title)}</h2>
    <div className="nonogram-board" data-solved={solved} style={{
      '--columns': width,
      '--row-clues': Math.max(...puzzle.rows.map(clue => clue.length)),
    } as CSSProperties}>
      <div className="nonogram-column-clues" aria-hidden="true">
        {puzzle.columns.map((runs, column) => <div key={column}>{runs.map((run, index) => <span key={index}>{run}</span>)}</div>)}
      </div>
      <div className="nonogram-cells" role="group" aria-label={t('Puzzle grid')}>
        {puzzle.rows.map((runs, row) => <div className="nonogram-row" key={row} role="group"
          aria-label={t('Row {row}, clues {clues}', { row: row + 1, clues: runs.join(', ') })}>
          <div className="nonogram-row-clue" aria-hidden="true">{runs.join(' ')}</div>
          {puzzle.columns.map((columnRuns, column) => {
            const index = row * width + column
            const state = cells[index]
            return <button key={column} className="nonogram-cell"
              ref={element => { squares.current[index] = element }}
              type="button" tabIndex={focus === index ? 0 : -1} data-mark={state}
              aria-disabled={solved}
              aria-label={t('Column {column}, clues {clues}, {mark}', {
                column: column + 1, clues: columnRuns.join(', '),
                mark: t(state === 1 ? 'filled' : state === 2 ? 'marked blank' : 'unmarked'),
              })}
              onFocus={() => setFocus(index)}
              onClick={() => move(index, mode)}
              onContextMenu={event => { event.preventDefault(); move(index, 2) }}
              onKeyDown={event => keyboard(event, index)}>
              {state === 2 && !solved && <span aria-hidden="true">×</span>}
            </button>
          })}
        </div>)}
      </div>
    </div>
    <div className="nonogram-tools" role="group" aria-label={t('Mark squares')}>
      {([['Fill', '■', 1], ['Mark blank', '×', 2], ['Erase', '□', 0]] as const).map(([label, symbol, mark]) =>
        <button key={mark} className="secondary" aria-pressed={mode === mark} disabled={solved} onClick={() => setMode(mark)}>
          <span aria-hidden="true">{symbol}</span> {t(label)}
        </button>)}
      <button className="secondary" disabled={!undo.length} onClick={() => {
        onMove(undo[undo.length - 1])
        setUndo(undo.slice(0, -1))
      }}><Undo2 size={17}/> {t('Undo')}</button>
    </div>
    {solved && <p className="nonogram-solved" role="status">{t('Puzzle solved!')}</p>}
  </section>
}
