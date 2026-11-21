import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Shuffle, Undo2 } from 'lucide-react'
import { z } from 'zod'
import { matchesClues, randomDifficulties, randomPuzzle, randomSizes, starterPack, type Cell, type Puzzle, type RandomOptions } from '../../../packages/nonograms/src/puzzles.js'
import { useT, type Translate } from './i18n.js'
import { PackTrail, type PackTrailStop } from './PackTrail.js'
import cockatoosCover from './assets/cockatoos-portrait.webp'
import './nonograms.css'

const marks = z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).max(100)
const line = z.array(z.number().int().min(0).max(10)).min(1).max(5)
const sizeSchema = z.union([z.literal(5), z.literal(10)])
const puzzleLines = z.array(line)
const savedPuzzle = z.object({ rows: puzzleLines, columns: puzzleLines }).refine(puzzle =>
  sizeSchema.safeParse(puzzle.rows.length).success && puzzle.rows.length === puzzle.columns.length)
const savedGame = z.object({
  completed: z.array(z.string()).optional(),
  boards: z.record(z.string(), marks),
  random: savedPuzzle.optional(),
  options: z.object({ size: sizeSchema, difficulty: z.enum(randomDifficulties) }).optional(),
})
type SavedGame = z.infer<typeof savedGame>

function readGame(key: string): SavedGame {
  try { return savedGame.parse(JSON.parse(localStorage.getItem(key) ?? 'null')) }
  catch { return { boards: {} } }
}

const menuPath = '/games/nonograms'
const roadmapPath = `${menuPath}/packs/${starterPack.id}/${starterPack.revision}`
const playPath = (id: string) => `${menuPath}/play/${id}`
type PuzzleTitle = (typeof starterPack.puzzles)[number]['title'] | 'Random puzzle'

function dimensions(puzzle: Puzzle) {
  return `${puzzle.rows.length} × ${puzzle.columns.length}`
}

function progressLabel(t: Translate, solved: boolean[]) {
  return t('{solved} of {total} solved', { solved: solved.filter(Boolean).length, total: solved.length })
}

export default function Nonograms({ profile, path, navigate, onActivity }: {
  profile: string
  path: string
  navigate: (path: string) => void
  onActivity: () => void
}) {
  const t = useT()
  const key = 'aviarium:nonograms:v1:' + profile
  const [saved, setSaved] = useState(() => readGame(key))
  const [error, setError] = useState('')
  const [options, setOptions] = useState<RandomOptions>(saved.options ?? { size: 10, difficulty: 'Medium' })
  const currentRandom = saved.boards.random ?? []
  const keepRandom = saved.random && !matchesClues(saved.random, currentRandom)
  const solved = starterPack.puzzles.map(({ id, puzzle }) =>
    saved.completed?.includes(id) || matchesClues(puzzle, saved.boards[id] ?? []))
  const nextStop = solved.indexOf(false)
  const starterIndex = starterPack.puzzles.findIndex(item => path === playPath(item.id))
  const starter = starterPack.puzzles[starterIndex]
  const random = path === playPath('random') ? saved.random : undefined
  const playableStarter = starter && (starterIndex === 0 || solved[starterIndex - 1])
  const puzzle = random || (playableStarter ? starter.puzzle : undefined)
  const selected = random ? 'random' : starter?.id
  const backPath = starter ? roadmapPath : menuPath

  function save(next: SavedGame) {
    setSaved(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setError('')
    } catch {
      setError(t('Progress could not be saved on this device.'))
    }
  }

  function openStop(id: string, puzzle: Puzzle) {
    const cells = saved.boards[id] ?? []
    if (matchesClues(puzzle, cells)) save({ ...saved, boards: { ...saved.boards, [id]: [] } })
    onActivity()
    navigate(playPath(id))
  }

  function newRandom() {
    if (keepRandom && currentRandom.some(Boolean) && !window.confirm(t('Replace your unfinished random puzzle?'))) return
    const random = randomPuzzle(options)
    if (!random) {
      setError(t('No random puzzle found. Try again.'))
      return
    }
    onActivity()
    save({ ...saved, boards: { ...saved.boards, random: [] }, random, options })
    navigate(playPath('random'))
  }

  if (puzzle && selected) return <>
    {error && <p className="notice" role="alert">{error}</p>}
    <PuzzleBoard key={selected} puzzle={puzzle} title={starter?.title ?? 'Random puzzle'}
      pack={Boolean(starter)} leave={() => navigate(backPath)} savedCells={saved.boards[selected]}
      onMove={cells => {
        onActivity()
        const completed = saved.completed ?? []
        save({ ...saved, boards: { ...saved.boards, [selected]: cells },
          completed: starter && matchesClues(puzzle, cells) && !completed.includes(selected)
            ? [...completed, selected] : completed })
      }}/>
  </>

  if (path === roadmapPath) {
    const stops: PackTrailStop[] = starterPack.puzzles.map(({ id, title, puzzle }, index) => {
      const locked = index > 0 && !solved[index - 1]
      const board = saved.boards[id] ?? []
      const inProgress = !matchesClues(puzzle, board) && board.some(Boolean)
      const action = t(inProgress ? 'Resume' : solved[index] ? 'Replay' : 'Play')
      const state = locked ? 'locked' : solved[index] ? 'solved' : index === nextStop ? 'next' : 'available'
      return {
        id, title: t(title), detail: dimensions(puzzle), state, actionLabel: action,
        actionName: t('{action} {title}', { action, title: t(title) }),
        statusLabel: locked ? t('Solve the previous stop to unlock') : solved[index] ? t('Solved')
          : index === nextStop ? t('Up next') : undefined,
        play: () => openStop(id, puzzle),
      }
    })
    return <section className="catalog pack-roadmap pack-meadow">
      <div className="game-navigation">
        <button className="text-button back" onClick={() => navigate(menuPath)}><ArrowLeft size={17}/> {t('Nonograms menu')}</button>
      </div>
      <header className="pack-banner">
        <img className="pack-backdrop" src={cockatoosCover} alt=""/>
        <div className="pack-intro">
          <h1>{t(starterPack.title)}</h1>
          <p>{t(starterPack.description)}</p>
          <p>{progressLabel(t, solved)}</p>
          <ul className="pack-tags"><li className="badge">{t('In order')}</li></ul>
        </div>
      </header>
      <PackTrail stops={stops} canPlay/>
    </section>
  }

  return <section className="catalog sudoku-menu" aria-labelledby="nonograms-title">
    <div className="game-menu-heading">
      <div className="game-navigation">
        <button className="text-button back" aria-label={t('Exit to library')} onClick={() => navigate('/')}><ArrowLeft size={17}/> {t('Library')}</button>
      </div>
      <div className="game-navigation">
        <h1 id="nonograms-title">Nonograms</h1>
        <a className="text-button" href={menuPath + '/how-to'}
          onClick={event => { event.preventDefault(); navigate(menuPath + '/how-to') }}><BookOpen size={17}/> {t('How to play')}</a>
      </div>
    </div>
    <section className="quick-play panel" aria-labelledby="nonogram-random-title">
      <form onSubmit={event => { event.preventDefault(); newRandom() }}>
        <div className="quick-play-header">
          <h2 id="nonogram-random-title">{t('Quick Play')}</h2>
          {keepRandom && <button type="button" className="text-button" onClick={() => navigate(playPath('random'))}>
            {t('Resume random puzzle')}
          </button>}
        </div>
        <div className="quick-play-actions nonogram-options">
          <select aria-label={t('Grid size')} value={options.size} onChange={event => {
            setOptions({ ...options, size: sizeSchema.parse(Number(event.target.value)) })
          }}>
            {randomSizes.map(size => <option key={size} value={size}>{size} × {size}</option>)}
          </select>
          <select aria-label={t('Difficulty')} value={options.difficulty} onChange={event => {
            const difficulty = randomDifficulties.find(value => value === event.target.value)
            if (difficulty) setOptions({ ...options, difficulty })
          }}>
            {randomDifficulties.map(difficulty => <option key={difficulty} value={difficulty}>{t(difficulty)}</option>)}
          </select>
          <button className="primary" type="submit"><Shuffle size={17}/> {t('New puzzle')}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>
    <section className="sudoku-packs" aria-labelledby="nonogram-packs-title">
      <h2 id="nonogram-packs-title">{t('Packs')}</h2>
      <div className="pack-cards">
        <button className="pack-card pack-meadow" onClick={() => navigate(roadmapPath)}>
          <img className="pack-cover nonogram-pack-cover" src={cockatoosCover} alt=""/>
          <div className="pack-card-copy">
            <span className="pack-card-title">{t(starterPack.title)}<ArrowRight size={18}/></span>
            <span>{progressLabel(t, solved)}</span>
          </div>
        </button>
      </div>
    </section>
  </section>
}

function markValue(current: Cell, tool: Cell, value: Cell) {
  return tool === 2 && current === 1 ? current : value
}

function PuzzleBoard({ puzzle, title, pack, leave, savedCells, onMove }: {
  puzzle: Puzzle
  title: PuzzleTitle
  pack: boolean
  leave: () => void
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
      setUndo(previous => [...previous.slice(-99), committed])
      onMove(active.next)
    }
  }

  function move(index: number, mark: Cell) {
    const value = markValue(cells[index], mark, cells[index] === mark ? 0 : mark)
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

  return <section className={pack ? 'play-page nonogram-play pack-play pack-meadow' : 'play-page nonogram-play'}
    aria-labelledby="nonogram-puzzle-title">
    {pack && <img className="pack-play-art" src={cockatoosCover} alt=""/>}
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t('Game menu')}</button>
    </div>
    <div className="play-heading">
      <div><div className="eyebrow">{pack ? t(starterPack.title) : 'Nonograms'}</div><h1 id="nonogram-puzzle-title">{t(title)}</h1></div>
      <div className="play-meta"><span className="badge">{dimensions(puzzle)}</span></div>
    </div>
    <div className="play-layout">
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
      <div className="play-controls">
        {solved && <section className="panel success" role="status">
          <h2>{t('Puzzle solved')}</h2>
          <p>{t('Your completion has been saved.')}</p>
          <button className="primary" onClick={leave}>{t(pack ? 'Back to roadmap' : 'Choose another puzzle')}</button>
        </section>}
        <div className="tools nonogram-tools" role="group" aria-label={t('Mark squares')}>
          {([['Fill', '■', 1], ['Mark blank', '×', 2], ['Erase', '□', 0]] as const).map(([label, symbol, mark]) =>
            <button key={mark} aria-pressed={mode === mark} disabled={solved} onClick={() => setMode(mark)}>
              <span aria-hidden="true">{symbol}</span> {t(label)}
            </button>)}
          <button disabled={!undo.length} onClick={() => {
            onMove(undo[undo.length - 1])
            setUndo(undo.slice(0, -1))
          }}><Undo2 size={18}/> {t('Undo')}</button>
        </div>
      </div>
    </div>
  </section>
}
