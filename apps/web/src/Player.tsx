import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { errorMessage } from './api.js'
import { levelTitle, packTitle, technique } from './sudoku-copy.js'
import type { Message } from './messages.js'
import { knownMessage, useT } from './i18n.js'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, Eraser, Heart, Lightbulb, Pause, Pencil, Play, Redo2, RotateCcw, Settings2, Timer, Undo2, WandSparkles } from 'lucide-react'
import type { Preferences, SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { bit, candidateMasks, column, conflicts, row, rules, rulesFor, type Board } from '../../../packages/sudoku/src/rules.js'
import { logicalHint, type LogicalStep } from '../../../packages/sudoku/src/logic.js'
import { effectivePackRules, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { validate } from '../../../packages/sudoku/src/solver.js'
import { Grid } from './Grid.js'
import { displayTime, PuzzleShare } from './SudokuMenu.js'
import { CelebrationOverlay, type CelebrationAction } from './CelebrationOverlay.js'
import type { LocalSession } from './storage.js'

export { createQuickPlayLevel } from './quick-play.js'

export function createSave(level: PublishedLevel, pack?: PublishedPack): SudokuSave {
  return { game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: level.ruleset === 2 ? 2 : 1, format: 1,
    board: rules.create(Array.from(level.grid, Number)), undo: [], redo: [], elapsedMs: 0, completed: false,
    packRevision: pack?.revision,
    lives: pack && level.pack ? effectivePackRules(pack, level.pack.stop).lives ?? undefined : undefined }
}

interface Props {
  session: LocalSession<SudokuSave>; level: PublishedLevel; preferences: Preferences; reader: boolean; pack?: PublishedPack
  persist: (data: SudokuSave) => Promise<void>; leave: () => void; reset: () => void; openSettings?: () => void; trial?: boolean
  leaderboard?: { open: () => void }
  bestMs?: number; testMode?: boolean
}
type Hint = { cell?: number } & ({ stage: 1 | 2 | 3; step: LogicalStep } | { stage?: never; message: Message })

function digitUsedUp(entries: readonly number[], digit: number) {
  return entries.filter(value => value === digit).length >= 9
}

export default function Player({ session, level, preferences, reader, pack, persist, leave, reset, openSettings, trial = false, bestMs, testMode = false, leaderboard }: Props) {
  const t = useT()
  const givens = useMemo(() => Array.from(level.grid, Number), [level.grid])
  const packRules = pack && level.pack ? effectivePackRules(pack, level.pack.stop) : undefined
  const diagonal = level.ruleset === 2
  const boardRules = rulesFor(diagonal)
  const lifeLimit = packRules?.lives
  const showHints = preferences.hints && packRules?.hints !== false
  const showAutoNotes = preferences.autoNotes && packRules?.autoNotes !== false
  const showTimer = packRules?.timeTrial || (preferences.timer && !reader)
  const solution = useMemo(() => {
    if (!lifeLimit) return undefined
    const result = validate(givens, 65_000, diagonal)
    return result.kind === 'unique' ? result.solution : undefined
  }, [givens, lifeLimit, diagonal])
  const [data, setData] = useState(session.data)
  const latest = useRef(data)
  const [selected, select] = useState(Math.max(givens.indexOf(0), 0))
  const [note, setNote] = useState(false)
  const [lockedDigit, setLockedDigit] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hint, setHint] = useState<Hint>()
  const excluded = useRef<number[]>([])
  const [lostLife, setLostLife] = useState<number>()
  const [problem, setProblem] = useState('')
  const [display, setDisplay] = useState(data.elapsedMs)
  const [celebration, setCelebration] = useState<number>()
  const started = useRef(Date.now())
  const press = useRef<{ pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; skipClick: boolean } | null>(null)
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer) }, [])
  const persistRef = useRef(persist)
  persistRef.current = persist
  function commit(next: SudokuSave) {
    latest.current = next
    setData(next)
    return persistRef.current(next).then(() => setProblem(''), error => setProblem(errorMessage(error)))
  }
  function snapshot(next = latest.current, completedNow = false) {
    const now = Date.now()
    const elapsedMs = paused || latest.current.completed || latest.current.lives === 0 ? latest.current.elapsedMs
      : latest.current.elapsedMs + Math.max(0, now - started.current)
    started.current = now
    setDisplay(elapsedMs)
    if (completedNow) setCelebration(elapsedMs)
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
      void persistRef.current(updated).catch(error => setProblem(errorMessage(error)))
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
      void persistRef.current(updated).catch(error => setProblem(errorMessage(error)))
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
      setLostLife(undefined)
    }
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    const completed = boardRules.verify(givens, board.entries)
    void snapshot({ ...current, board, undo: [...current.undo, current.board].slice(-40), redo: [],
      completed, completedAt: completed ? Date.now() : undefined }, completed && !current.completed)
  }
  function move(digit: number, cell = selected) {
    const current = latest.current
    if (paused || finished || current.completed || current.lives === 0 || givens[cell]) return
    const board = current.board
    if (digit && !note && digitUsedUp(board.entries, digit)) return
    if (digit && !note && current.lives !== undefined && solution && digit !== solution[cell]) {
      const lives = current.lives - 1
      setLostLife(lives || undefined)
      void snapshot({ ...current, lives })
      return
    }
    saveBoard(boardRules.apply(givens, board, { cell, digit, note, autoNoteDeletion: preferences.autoNoteDeletion }))
  }
  function autoNotes() {
    const board = latest.current.board
    const notes = candidateMasks(board.entries, diagonal)
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
    setLostLife(undefined)
    if (!note && lockedDigit && digitUsedUp(board.entries, lockedDigit)) setLockedDigit(0)
    const other = direction === 'undo' ? 'redo' : 'undo'
    const completed = boardRules.verify(givens, board.entries)
    void snapshot({ ...current, board, [direction]: source.slice(0, -1), [other]: [...current[other], current.board].slice(-40),
      completed, completedAt: completed ? Date.now() : undefined }, completed && !current.completed)
  }
  function autoSolve() {
    if (paused || finished) return
    const result = validate(givens, 65_000, diagonal)
    if (result.kind !== 'unique') return
    const current = latest.current
    saveBoard({ ...current.board, entries: [...result.solution] })
  }
  function getHint() {
    if (hint?.stage) {
      if (hint.stage < 3) setHint({ ...hint, stage: hint.stage === 1 ? 2 : 3 })
      return
    }
    const board = latest.current.board.entries
    const bad = conflicts(board, diagonal)
    if (bad.size) {
      setHint({ message: "Check the highlighted conflict before requesting a hint.", cell: [...bad][0] })
      return
    }
    const result = validate(board, 5_000, diagonal)
    if (result.kind === 'unsolvable') {
      setHint({ message: "The current entries cannot lead to a solution. Try undoing a move." })
      return
    }
    const step = logicalHint(board, excluded.current, diagonal)
    if (step) {
      setHint({ step, stage: 1 })
    } else setHint({ message: 'No supported logical deduction was found for this board.' })
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
  const cellText = (index: number) => t('row {row}, column {column}', { row: row(index) + 1, column: column(index) + 1 })
  function describeHint(current: Hint) {
    if (!current.stage) return t(current.message)
    const step = current.step
    if (current.stage === 3) return step.updates.map(({ index, filledValue, eliminatedCandidate }) => filledValue
      ? t('Place {digit} in {cell}.', { digit: filledValue, cell: cellText(index) })
      : t('Eliminate {digit} from {cell}.', { digit: eliminatedCandidate!, cell: cellText(index) })).join(' ')
    const techniqueText = t('Try the {technique} technique.', { technique: technique(t, step) })
    const explanation = step.diagonal ? t('Find a digit that can fit in only one cell of a diagonal.') : step.id === 'hidden-single' ? t('Find a digit that can fit in only one cell of a row, column, or box.')
      : step.id === 'naked-single' || step.id === 'open-singles' ? t('Find an empty cell with just one possible digit.')
        : step.type === 'elimination' ? t('Find the pattern to identify which candidates it rules out.') : undefined
    const prompt = current.stage === 1 ? t('Press Hint again to highlight the cell.')
      : t('{count, plural, one {Look at the highlighted cell.} other {Look at the highlighted cells.}}', { count: hintCells?.size ?? 0 }) +
        ' ' + t('Press Hint again to reveal the deduction.')
    return [techniqueText, explanation, prompt].filter(Boolean).join(' ')
  }
  const seconds = Math.floor(display / 1000)
  const packArt = pack?.data.background ?? pack?.data.cover
  const celebrationStats = celebration !== undefined ? [
    { label: t('Difficulty'), value: t(level.difficulty) },
    ...(pack && level.pack ? [{ label: t('Pack'), value: packTitle(t, pack) + ' · ' +
      t('Stop {stop} of {total}', { stop: level.pack.stop, total: pack.data.puzzles.length }) }] : []),
    ...(data.lives !== undefined && lifeLimit ? [{ label: t('Lives left'), value: data.lives + ' / ' + lifeLimit }] : []),
  ] : []
  const celebrationActions: CelebrationAction[] = celebration !== undefined ? [
    { kind: 'primary', label: t(trial ? 'Back to editor' : pack ? 'Back to roadmap' : 'Choose another puzzle'), onClick: leave },
    ...(trial ? [] : [{ kind: 'secondary' as const, label: t('Play again'), onClick: reset }]),
    ...(leaderboard ? [{ kind: 'secondary' as const, label: t('View leaderboard'), onClick: leaderboard.open }] : []),
    { kind: 'text', label: t('View solved puzzle'), onClick: () => setCelebration(undefined) },
  ] : []
  return <div className={pack ? `play-page pack-play pack-${pack.data.theme}` : 'play-page'}>
    {packArt && <img className="pack-play-art" alt="" src={packArt}/>}
    <div className="game-navigation">
      <button className="text-button back" onClick={() => { void snapshot().then(leave) }}><ArrowLeft size={17}/>{" "}{t(trial ? "Back to editor" : pack ? "Back to roadmap" : "Game menu")}</button>
      <div className="game-nav-tools">
        {testMode && !finished && <button className="text-button" disabled={paused} onClick={autoSolve}
          title={t("Test environment")}><WandSparkles size={17}/>{" "}{t("Auto solve")}</button>}
        {openSettings && <button className="icon-button" title={t("Sudoku settings")} aria-label={t("Sudoku settings")} onClick={openSettings}><Settings2 size={18}/></button>}
      </div>
    </div>
    <div className="play-heading"><div><div className="eyebrow">{pack ? packTitle(t, pack) : 'Sudoku'}</div><h1>{levelTitle(t, level)}</h1></div>
      <div className="play-meta"><span className={'badge ' + level.difficulty.toLowerCase()}>{t(level.difficulty)}</span>
        {data.lives !== undefined && <span className="clock" aria-label={t('{count, plural, one {# life remaining} other {# lives remaining}}', { count: data.lives })}><Heart size={16}/>{data.lives}/{lifeLimit}</span>}
        {showTimer && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div></div>
    <div className="play-layout">
      <div className="board-wrap">
        {paused ? <div className="pause-panel"><h2>{t("Game paused")}</h2><button className="primary" onClick={() => { started.current = Date.now(); setPaused(false) }}><Play size={18}/>{" "}{t("Resume game")}</button></div>
          : <Grid entries={data.board.entries} notes={data.board.notes} givens={givens} selected={selected} select={select}
            enter={move} activate={cell => { select(cell); if (lockedDigit) move(lockedDigit, cell) }}
            highlightedDigit={lockedDigit || data.board.entries[selected]} hintCell={visibleHint?.cell} hintCells={hintCells}
            errors={preferences.mistakes ? conflicts(data.board.entries, diagonal) : undefined} diagonal={diagonal} disabled={finished}/>}
      </div>
      <div className="play-controls">
        {finished ? <section className="panel success">
          <h2>{gameOver ? t("Out of lives") : t("Puzzle solved")}</h2>
          {gameOver
            ? <p>{t("Start a fresh attempt to try this stop again.")}</p>
            : <div className="leaderboard-result">
              <strong>{displayTime(data.elapsedMs)}</strong>
              <span>{t(trial ? 'Test complete' : 'Saved')}</span>
            </div>}
          <button className="primary" onClick={gameOver ? reset : leave}>{gameOver ? t("Retry puzzle") : pack ? t("Back to roadmap") : t("Choose another puzzle")}</button>
          {!gameOver && <div className="button-bar">
            {leaderboard && <button className="secondary" onClick={leaderboard.open}>{t('View leaderboard')}</button>}
            <PuzzleShare level={level}/>
          </div>}
        </section>
          : <><div className="number-pad" aria-label={t("Digits")}>{Array.from({ length: 9 }, (_, index) => {
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
            <button disabled={paused || !data.undo.length} onClick={() => history('undo')}><Undo2 size={18}/>{" "}{t("Undo")}</button>
            <button disabled={paused || !data.redo.length} onClick={() => history('redo')}><Redo2 size={18}/>{" "}{t("Redo")}</button>
            <button disabled={paused} aria-pressed={note} onClick={() => {
              if (note && lockedDigit && digitUsedUp(data.board.entries, lockedDigit)) setLockedDigit(0)
              setNote(!note)
            }}><Pencil size={18}/>{" "}{t("Notes")}</button>
            {showAutoNotes && <button disabled={paused} onClick={autoNotes}><Pencil size={18}/>{" "}{t("Auto notes")}</button>}
            <button disabled={paused} onClick={() => { setLockedDigit(0); move(0) }}><Eraser size={18}/>{" "}{t("Erase")}</button>
            {showHints && <button disabled={paused} onClick={getHint}><Lightbulb size={18}/>{" "}{t("Hint")}</button>}
            <button onClick={() => { if (!paused) void snapshot(); setPaused(!paused) }}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? t("Resume") : t("Pause")}</button>
          </div>
          {visibleHint && <p role="status" className="feedback">{describeHint(visibleHint)}</p>}
          {visibleHint?.stage === 3 && visibleHint.step.type === 'elimination' && <button className="secondary"
            onClick={() => applyEliminations(visibleHint.step)}>{t("Apply deduction")}</button>}
          {lostLife !== undefined && <p role="status" className="error">
            {t('Wrong digit. {count, plural, one {# life} other {# lives}} left.', { count: lostLife })}
          </p>}
          {!pack && level.seed && <PuzzleShare level={level}/>}
          </>}
        {!gameOver && <button className="text-button" onClick={() => { if (confirm(t("Start over? Your current saved game will be deleted."))) reset() }}>
          <RotateCcw size={16}/>{" "}{t("Reset puzzle")}
        </button>}
        <p role="alert" className="error">{problem && t('Save failed. {detail}', { detail: knownMessage(t, problem) })}</p>
      </div>
    </div>
    {celebration !== undefined && <CelebrationOverlay reader={reader}
      result={{ elapsedMs: celebration, bestMs: trial ? undefined : bestMs, stats: celebrationStats,
        saveNote: trial ? t('Test complete') : problem ? t('Save failed. {detail}', { detail: knownMessage(t, problem) })
          : t('Your completion has been saved.'),
        saveError: Boolean(problem) && !trial }}
      actions={celebrationActions} onClose={() => setCelebration(undefined)}/>}
  </div>
}
