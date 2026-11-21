import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowLeft, BookOpen, ChevronDown, Shuffle, Undo2 } from 'lucide-react'
import { z } from 'zod'
import { matchesClues, randomDifficulties, randomPuzzle, randomSizes, starterPack, type Cell, type Puzzle, type RandomOptions } from '../../../packages/nonograms/src/puzzles.js'
import { useT } from './i18n.js'
import './nonograms.css'

const marks = z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).max(100)
const line = z.array(z.number().int().min(0).max(10)).min(1).max(5)
const sizeSchema = z.union([z.literal(5), z.literal(10)])
const puzzleLines = z.array(line)
const savedPuzzle = z.object({ rows: puzzleLines, columns: puzzleLines }).refine(puzzle =>
  sizeSchema.safeParse(puzzle.rows.length).success && puzzle.rows.length === puzzle.columns.length)
const savedGame = z.object({
  selected: z.string().optional(),
  boards: z.record(z.string(), marks),
  random: savedPuzzle.optional(),
  options: z.object({ size: sizeSchema, difficulty: z.enum(randomDifficulties) }).optional(),
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
  const [options, setOptions] = useState<RandomOptions>(saved.options ?? { size: 10, difficulty: 'Medium' })
  const [packOpen, setPackOpen] = useState(() => starterPack.puzzles.some(item => item.id === saved.selected))
  const starter = starterPack.puzzles.find(item => item.id === saved.selected)
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
    const random = randomPuzzle(options)
    if (!random) {
      setError(t('No random puzzle found. Try again.'))
      return
    }
    onActivity()
    save({ ...saved, selected: 'random', boards: { ...saved.boards, random: [] }, random, options })
  }

  return <section className="catalog nonograms" aria-labelledby="nonograms-title">
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t('Library')}</button>
      <button className="text-button" onClick={guide}><BookOpen size={17}/> {t('How to play')}</button>
    </div>
    <h1 id="nonograms-title">Nonograms</h1>
    <div className="nonogram-menu">
      <section className="panel padded nonogram-menu-section" aria-labelledby="nonogram-random-title">
        <h2 id="nonogram-random-title">{t('Quick Play')}</h2>
        <form className="nonogram-options" onSubmit={event => { event.preventDefault(); newRandom() }}>
          <label>{t('Grid size')}<select value={options.size} onChange={event => {
            setOptions({ ...options, size: sizeSchema.parse(Number(event.target.value)) })
          }}>
            {randomSizes.map(size => <option key={size} value={size}>{size} × {size}</option>)}
          </select></label>
          <label>{t('Difficulty')}<select value={options.difficulty} onChange={event => {
            const difficulty = randomDifficulties.find(value => value === event.target.value)
            if (difficulty) setOptions({ ...options, difficulty })
          }}>
            {randomDifficulties.map(difficulty => <option key={difficulty} value={difficulty}>{t(difficulty)}</option>)}
          </select></label>
          <button className="primary" type="submit"><Shuffle size={17}/> {t('Random puzzle')}</button>
        </form>
        {keepRandom && selected !== 'random' && <button className="secondary" onClick={() => select('random')}>
          {t('Resume random puzzle')}
        </button>}
      </section>
      <section className="panel padded nonogram-menu-section" aria-labelledby="nonogram-packs-title">
        <h2 id="nonogram-packs-title">{t('Packs')}</h2>
        <button className="secondary nonogram-pack-trigger" aria-expanded={packOpen} aria-controls="nonogram-starter-pack"
          onClick={() => setPackOpen(!packOpen)}>{t(starterPack.title)} <ChevronDown size={16}/></button>
        <div className="nonogram-picker" id="nonogram-starter-pack" hidden={!packOpen}>
          {starterPack.puzzles.map(({ id, title, puzzle }) => <button key={id} className="secondary"
            aria-pressed={selected === id} onClick={() => select(id)}>
            {t(title)} <small>{puzzle.rows.length} × {puzzle.columns.length}</small>
          </button>)}
        </div>
      </section>
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
  title: (typeof starterPack.puzzles)[number]['title'] | 'Random puzzle'
  savedCells?: Cell[]
  onMove: (cells: Cell[]) => void
}) {
  const t = useT()
  const width = puzzle.columns.length
  const height = puzzle.rows.length
  const committed: Cell[] = savedCells?.length === width * height ? savedCells : Array(width * height).fill(0)
  const [painted, setPainted] = useState<Cell[]>()
  const cells = painted ?? committed
  const solved = matchesClues(puzzle, committed)
  const [mode, setMode] = useState<Cell>(1)
  const [focus, setFocus] = useState(0)
  const [undo, setUndo] = useState<Cell[][]>([])
  const squares = useRef<(HTMLButtonElement | null)[]>([])

  const stroke = useRef<{
    id: number; value: Cell; next: Cell[]; x: number; y: number; step: number
  } | null>(null)

  function startStroke(event: PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cell]')
    if (solved || event.button !== 0 || !event.isPrimary || stroke.current || !cell) return
    const index = Number(cell.dataset.cell)
    const value = cells[index] === mode ? 0 : mode
    const next = [...cells]
    next[index] = value
    const { width, height } = cell.getBoundingClientRect()
    stroke.current = { id: event.pointerId, value, next, x: event.clientX, y: event.clientY,
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
      if (next[index] === active.value) continue
      if (next === active.next) next = [...next]
      next[index] = active.value
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
      setUndo(previous => [...previous.slice(-99), committed])
      onMove(active.next)
    }
  }

  function move(index: number, mark: Cell) {
    const value = cells[index] === mark ? 0 : mark
    if (solved || stroke.current || cells[index] === value) return
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
      <div className="nonogram-cells" role="group" aria-label={t('Puzzle grid')}
        onPointerDown={startStroke} onPointerMove={paint} onPointerUp={endStroke}
        onPointerCancel={endStroke} onLostPointerCapture={endStroke}>
        {puzzle.rows.map((runs, row) => <div className="nonogram-row" key={row} role="group"
          aria-label={t('Row {row}, clues {clues}', { row: row + 1, clues: runs.join(', ') })}>
          <div className="nonogram-row-clue" aria-hidden="true">{runs.join(' ')}</div>
          {puzzle.columns.map((columnRuns, column) => {
            const index = row * width + column
            const state = cells[index]
            return <button key={column} className="nonogram-cell"
              ref={element => { squares.current[index] = element }}
              type="button" tabIndex={focus === index ? 0 : -1} data-mark={state} data-cell={index}
              aria-disabled={solved}
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
