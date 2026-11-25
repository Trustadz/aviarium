import { hintCooldownMs, hintCooldownRemaining, resetSudokuInput, type Preferences, type PublishedLevel, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { errorMessage } from './api.js'
import { levelTitle, packChapterTitle, packTitle } from './sudoku-copy.js'
import { knownMessage, useT } from './i18n.js'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ArrowLeft, Eraser, Heart, Lightbulb, Pause, Pencil, Play, Redo2, RotateCcw, Settings2, Timer, Undo2, WandSparkles } from 'lucide-react'
import { bit, candidateMasks, conflicts, rulesFor, type Board } from '../../../packages/sudoku/src/rules.js'
import { logicalHint, type LogicalStep } from '../../../packages/sudoku/src/logic.js'
import type { PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { effectiveChapterRules, packStopAt, packTheme } from '../../../packages/game-sdk/src/packs.js'
import { createSave } from '../../../packages/sudoku/src/save.js'
export { createSave } from '../../../packages/sudoku/src/save.js'
import { validate } from '../../../packages/sudoku/src/solver.js'
import { Grid } from './Grid.js'
import { HintDrawer, type Hint } from './HintDrawer.js'
import { displayTime, PuzzleShare } from './SudokuMenu.js'
import { CelebrationOverlay, type CelebrationAction } from './CelebrationOverlay.js'
import type { LocalSession } from './storage.js'

export { createQuickPlayLevel } from './quick-play.js'



interface Props {
  session: LocalSession<SudokuSave>; level: PublishedLevel; preferences: Preferences; reader: boolean; pack?: PublishedPack
  persist: (data: SudokuSave) => Promise<void>; leave: () => void; finish?: () => void; reset: () => void; openSettings?: () => void; trial?: boolean
  leaderboard?: { open: () => void }
  bestMs?: number; testMode?: boolean
  challenge?: { occurrenceId: string; slotId: string; game: string; attemptId: string; endsAt: string }
  standingsPanel?: ReactNode
  replay?: { label: string; backLabel?: string }
}
function digitUsedUp(entries: readonly number[], digit: number) {
  return entries.filter(value => value === digit).length >= 9
}

export default function Player({ session, level, preferences, reader, pack, persist, leave, finish, reset, openSettings, trial = false, bestMs, testMode = false, leaderboard, challenge, standingsPanel, replay }: Props) {
  const t = useT()
  const challengeMode = Boolean(challenge)
  const givens = useMemo(() => Array.from(level.grid, Number), [level.grid])
  const packLocation = pack && level.pack ? packStopAt(pack, level.pack.stop) : undefined
  const chapter = packLocation?.chapter
  const packRules = packLocation ? effectiveChapterRules(packLocation.chapter, packLocation.chapterStop) : undefined
  const diagonal = level.ruleset === 2
  const boardRules = rulesFor(diagonal)
  const lifeLimit = packRules?.lives
  const showHints = preferences.hints && packRules?.hints !== false
  const showAutoNotes = preferences.autoNotes && packRules?.autoNotes !== false
  const showTimer = challengeMode || packRules?.timeTrial || (preferences.timer && !reader)
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
  const [hintOpen, setHintOpen] = useState(false)
  const [cooldownNow, setCooldownNow] = useState(() => Date.now())
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const excluded = useRef<number[]>([])
  const [lostLife, setLostLife] = useState<number>()
  const [problem, setProblem] = useState('')
  const [display, setDisplay] = useState(data.elapsedMs)
  const [celebration, setCelebration] = useState<number>()
  const started = useRef(Date.now())
  const press = useRef<{ pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; skipClick: boolean } | null>(null)
  useEffect(() => () => {
    if (press.current) clearTimeout(press.current.timer)
    clearTimeout(hintTimer.current)
  }, [])
  /** Show a new hint. The count is reported with the result but never ranked. */
  function showHint(next: Hint) {
    clearTimeout(hintTimer.current)
    setHint(next)
    setHintOpen(true)
  }
  /** Animate the panel out, then drop the board highlight and the hint text. */
  function dismissHint() {
    setHintOpen(false)
    clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(undefined), 220)
  }
  /** Drop a hint immediately when the board changes underneath it. */
  function clearHint() {
    clearTimeout(hintTimer.current)
    setHintOpen(false)
    setHint(undefined)
  }
  /** Put the panel away but keep the hint, highlight and count for reopening. */
  function collapseHint() {
    if (!hintOpen) return
    clearTimeout(hintTimer.current)
    setHintOpen(false)
  }
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
  useEffect(() => { if (paused) setHintOpen(false) }, [paused])
  useEffect(() => {
    if ((data.hintCooldownUntil ?? 0) <= Date.now()) return
    const timer = setTimeout(() => setCooldownNow(Date.now()), 1000)
    return () => clearTimeout(timer)
  }, [cooldownNow, data.hintCooldownUntil])
  /** Clear the board only: keep the attempt, elapsed time, lives, aids and revisions. */
  function resetInput() {
    if (finished) return
    excluded.current = []
    clearHint()
    setLostLife(undefined)
    setLockedDigit(0)
    select(Math.max(givens.indexOf(0), 0))
    void snapshot(resetSudokuInput(latest.current, givens))
  }
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
      // A daily challenge is timed; hiding the tab must not stop the clock.
      if (!document.hidden || challengeMode) return
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
  }, [challengeMode, paused, finished, showTimer])

  function saveBoard(board: Board) {
    const current = latest.current
    if (board === current.board) return
    if (board.entries !== current.board.entries) {
      excluded.current = []
      clearHint()
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
    clearHint()
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
  function requestHint() {
    if (paused || finished) return
    if (hint) {
      clearTimeout(hintTimer.current)
      setHintOpen(true)
      return
    }
    if (hintCooldownRemaining(latest.current) > 0) return
    const board = latest.current.board.entries
    const bad = conflicts(board, diagonal)
    if (bad.size) {
      showHint({ kind: 'conflict', message: "Check the highlighted conflict before requesting a hint.", cells: [...bad] })
      return
    }
    const result = validate(board, 5_000, diagonal)
    if (result.kind === 'unsolvable') {
      showHint({ kind: 'unsolvable', message: "The current entries cannot lead to a solution. Try undoing a move." })
      return
    }
    const step = logicalHint(board, excluded.current, diagonal)
    if (!step) {
      showHint({ kind: 'none', message: 'No supported logical deduction was found for this board.' })
      return
    }
    const now = Date.now()
    setCooldownNow(now)
    showHint({ step, stage: 1 })
    void snapshot({ ...latest.current, hintsUsed: (latest.current.hintsUsed ?? 0) + 1,
      hintCooldownUntil: now + hintCooldownMs })
  }
  function advanceHint() {
    if (!hint?.stage || hint.stage >= 3) return
    setHint({ ...hint, stage: hint.stage === 1 ? 2 : 3 })
  }
  function applyEliminations(step: LogicalStep) {
    const board = latest.current.board
    const notes = [...board.notes]
    for (const { index, eliminatedCandidate } of step.updates) if (eliminatedCandidate) {
      excluded.current[index] = (excluded.current[index] ?? 0) | bit(eliminatedCandidate)
      notes[index] &= ~bit(eliminatedCandidate)
    }
    if (notes.some((mask, cell) => mask !== board.notes[cell])) saveBoard({ ...board, notes })
    clearHint()
  }
  const visibleHint = showHints && !paused && !finished ? hint : undefined
  const hintCells = visibleHint
    ? visibleHint.stage && visibleHint.stage > 1
      ? new Set([...(visibleHint.step.patternCells ?? []), ...visibleHint.step.updates.map(update => update.index)])
      : visibleHint.cells ? new Set(visibleHint.cells) : undefined
    : undefined
  const hintsUsed = data.hintsUsed ?? 0
  const hintCooldown = hintCooldownRemaining(data, cooldownNow)
  const hintCoolingDown = hintCooldown > 0
  const hintSeconds = Math.ceil(hintCooldown / 1000)
  function selectCell(cell: number) {
    collapseHint()
    select(cell)
  }
  const seconds = Math.floor(display / 1000)
  const packArt = chapter?.background ?? chapter?.cover
  const packTitleText = pack ? packTitle(t, pack) : ''
  const chapterTitleText = pack && chapter ? packChapterTitle(t, pack as PublishedPack, chapter) : ''
  const packName = chapterTitleText && chapterTitleText !== packTitleText
    ? packTitleText + ' · ' + chapterTitleText : packTitleText
  const celebrationStats = celebration !== undefined ? [
    { label: t('Difficulty'), value: t(level.difficulty) },
    ...(pack && packLocation ? [{ label: t('Pack'), value: packName + ' · ' +
      t('Stop {stop} of {total}', { stop: packLocation.chapterStop, total: chapter?.puzzles.length ?? 0 }) }] : []),
    ...(data.lives !== undefined && lifeLimit ? [{ label: t('Lives left'), value: data.lives + ' / ' + lifeLimit }] : []),
    ...(showHints ? [{ label: t('Hints used'), value: hintsUsed === 0 ? t('None') : String(hintsUsed) }] : []),
  ] : []
  const celebrationActions: CelebrationAction[] = celebration !== undefined ? [
    { kind: 'primary', label: trial ? t('Back to editor') : replay?.backLabel ?? t(challengeMode ? 'Back to challenges' : pack ? 'Back to roadmap' : 'Choose another puzzle'), onClick: finish ?? leave },
    ...(trial || challengeMode ? [] : [{ kind: 'secondary' as const, label: t('Play again'), onClick: reset }]),
    ...(leaderboard ? [{ kind: 'secondary' as const, label: t('View leaderboard'), onClick: leaderboard.open }] : []),
    { kind: 'text', label: t('View solved puzzle'), onClick: () => setCelebration(undefined) },
  ] : []
  return <div className={pack ? `play-page pack-play pack-${chapter?.theme ?? packTheme(pack)}` : 'play-page'}>
    {packArt && <img className="pack-play-art" alt="" src={packArt}/>}
    <div className="game-navigation">
      <button className="text-button back" onClick={() => { void snapshot().then(leave) }}><ArrowLeft size={17}/>{" "}{trial ? t("Back to editor") : replay?.backLabel ?? t(challengeMode ? "Back to challenges" : "Back")}</button>
      <div className="game-nav-tools">
        {testMode && !finished && <button className="text-button" disabled={paused} onClick={autoSolve}
          title={t("Test environment")}><WandSparkles size={17}/>{" "}{t("Auto solve")}</button>}
        {openSettings && <button className="icon-button" title={t("Sudoku settings")} aria-label={t("Sudoku settings")} onClick={openSettings}><Settings2 size={18}/></button>}
      </div>
    </div>
    <div className="play-heading"><div><div className="eyebrow">{challengeMode ? t('Daily challenge') : pack ? packName : 'Sudoku'}</div><h1>{levelTitle(t, level)}</h1></div>
      <div className="play-meta"><span className={'badge ' + level.difficulty.toLowerCase()}>{t(level.difficulty)}</span>
        {data.lives !== undefined && <span className="clock" aria-label={t('{count, plural, one {# life remaining} other {# lives remaining}}', { count: data.lives })}><Heart size={16}/>{data.lives}/{lifeLimit}</span>}
        {showTimer && <span className="clock"><Timer size={17}/>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div></div>
    {replay && <p className="notice replay-notice" role="status">{replay.label}</p>}
    <div className="play-layout">
      <div className="board-wrap">
        {paused ? <div className="pause-panel"><h2>{t("Game paused")}</h2><button className="primary" onClick={() => { started.current = Date.now(); setPaused(false) }}><Play size={18}/>{" "}{t("Resume game")}</button></div>
          : <Grid entries={data.board.entries} notes={data.board.notes} givens={givens} selected={selected} select={selectCell}
            enter={move} activate={cell => { collapseHint(); select(cell); if (lockedDigit) move(lockedDigit, cell) }}
            highlightedDigit={lockedDigit || data.board.entries[selected]} hintCells={hintCells}
            errors={preferences.mistakes ? conflicts(data.board.entries, diagonal) : undefined} diagonal={diagonal} disabled={finished}/>}
      </div>
      <div className="play-controls">
        {finished ? <section className="panel success">
          <h2>{gameOver ? (challengeMode ? t('Challenge failed') : t('Out of lives')) : challengeMode ? t('Daily challenge completed') : t('Puzzle solved')}</h2>
          {gameOver
            ? <p>{t("Start a fresh attempt to try this stop again.")}</p>
            : <div className="leaderboard-result">
              <strong>{displayTime(data.elapsedMs)}</strong>
              <span>{t(trial ? 'Test complete' : 'Saved')}</span>
            </div>}
          <button className="primary" onClick={gameOver ? (challengeMode ? leave : reset) : finish ?? leave}>{gameOver ? (challengeMode ? t('Back to challenges') : t('Retry puzzle')) : challengeMode ? t('Back to challenges') : pack ? t("Back to roadmap") : t("Choose another puzzle")}</button>
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
            {!challengeMode && <button onClick={() => { if (!paused) void snapshot(); setPaused(!paused) }}>{paused ? <Play size={18}/> : <Pause size={18}/>} {paused ? t("Resume") : t("Pause")}</button>}
          </div>
          {lostLife !== undefined && <p role="status" className="error">
            {t('Wrong digit. {count, plural, one {# life} other {# lives}} left.', { count: lostLife })}
          </p>}
          {!pack && !challengeMode && level.seed && <PuzzleShare level={level}/>}
          </>}
        {!finished && <div className="play-footer">
          {showHints && <button type="button" className="hint-trigger" disabled={paused || (!visibleHint && hintCoolingDown)}
            aria-haspopup="dialog" aria-controls={visibleHint ? 'sudoku-hint' : undefined}
            aria-expanded={hintOpen && Boolean(visibleHint)}
            aria-label={visibleHint?.stage ? t('Hint, step {step} of 3', { step: visibleHint.stage })
              : !visibleHint && hintCoolingDown ? t('{count, plural, one {Hint available in # second} other {Hint available in # seconds}}', { count: hintSeconds })
                : t('Hint')}
            title={!visibleHint && hintCoolingDown
              ? t('{count, plural, one {Hint available in # second} other {Hint available in # seconds}}', { count: hintSeconds })
              : undefined}
            onClick={hintOpen ? dismissHint : requestHint}>
            <Lightbulb size={18} aria-hidden="true"/><span>{t("Hint")}</span>
            {/* Fixed-width slot: step dots or the cooldown, so the trigger never reflows. */}
            <span className="hint-steps" aria-hidden="true"
              data-visible={visibleHint?.stage ? true : undefined}
              data-cooldown={!visibleHint && hintCoolingDown ? true : undefined}>
              {!visibleHint && hintCoolingDown ? hintSeconds + 's'
                : [1, 2, 3].map(step => <span key={step} data-on={visibleHint?.stage && step <= visibleHint.stage ? true : undefined}/>)}
            </span>
          </button>}
          <button className="text-button" onClick={() => { if (confirm(t("Reset the board? Your board clears, the game stays saved, and the timer keeps running."))) resetInput() }}>
            <RotateCcw size={16}/>{" "}{t("Reset puzzle")}
          </button>
          {visibleHint && <HintDrawer hint={visibleHint} open={hintOpen} hintsUsed={hintsUsed}
            onClose={dismissHint} onAdvance={advanceHint}
            onApply={() => { if (visibleHint.stage) applyEliminations(visibleHint.step) }}/>}
        </div>}
        <p role="alert" className="error">{problem && t('Save failed. {detail}', { detail: knownMessage(t, problem) })}</p>
      </div>
    </div>
    {celebration !== undefined && <CelebrationOverlay reader={reader}
      result={{ elapsedMs: celebration, bestMs: trial ? undefined : bestMs, stats: celebrationStats,
        saveNote: trial ? t('Test complete') : problem ? t('Save failed. {detail}', { detail: knownMessage(t, problem) }) : undefined,
        saveError: Boolean(problem) && !trial }}
      actions={celebrationActions} heading={challengeMode ? t('Daily challenge completed') : undefined}
      onClose={() => setCelebration(undefined)}>{standingsPanel}</CelebrationOverlay>}
  </div>
}
