import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowLeft, Trophy } from 'lucide-react'
import {
  quickPlayVersion, quickTwenty48, type Twenty48Level, type Twenty48Save,
} from '../../../packages/game-2048/src/contracts.js'
import { createRandom } from '../../../packages/game-2048/src/random.js'
import {
  applyMove, boardFromTiles, maxTile, moveTiles, noMoves, spawnTile, tileCount, tilesFromBoard,
  type Board, type Direction, type Tile,
} from '../../../packages/game-2048/src/rules.js'
import { errorMessage } from './api.js'
import { CelebrationOverlay, type CelebrationAction } from './CelebrationOverlay.js'
import type { GamePlayerProps } from './game-web.js'
import { knownMessage, useT } from './i18n.js'
import { displayTime } from './SudokuMenu.js'
import { randomId } from './random.js'
import './twenty48.css'

// Keep these in step with the --twenty48-* variables in twenty48.css.
const slideMs = 180
const spawnMs = 200
const popMs = 320
// A new tile appears in the last tenth of the slide, once the board has settled.
const spawnDelayMs = Math.round(slideMs * 0.9)
const resolveAfterMs = slideMs + 20

function settledTiles(tiles: readonly Tile[]) {
  return tiles.map(tile => ({ ...tile, value: tile.nextValue ?? tile.value, nextValue: undefined,
    merged: false, spawned: false })).filter(tile => !tile.removing)
}

type Result =
  | { kind: 'goal'; score: number; elapsedMs: number; best: number | undefined; newBest: boolean; moves: number }
  | { kind: 'over'; score: number; elapsedMs: number; best: number | undefined; newBest: boolean; moves: number }

function formatScore(value: number) {
  return new Intl.NumberFormat().format(value)
}

function initialTiles(level: Twenty48Level, save: Twenty48Save) {
  const random = createRandom(level.seed ?? '', level.generatorVersion ?? quickPlayVersion)
  let board: Board = [...level.content.start]
  for (const move of save.moves) board = applyMove(board, move as Direction, random).board
  return { tiles: tilesFromBoard(board), random }
}

const keyDirections: Record<string, Direction> = {
  ArrowUp: 0, w: 0, W: 0,
  ArrowRight: 1, d: 1, D: 1,
  ArrowDown: 2, s: 2, S: 2,
  ArrowLeft: 3, a: 3, A: 3,
}

export default function Twenty48({ session, level, persist, leave, finish, launch, leaderboard, bestScore,
  challenge, standingsPanel, replay, reader, sync }: GamePlayerProps) {
  const t = useT()
  const gameLevel = level as Twenty48Level
  const [save, setSave] = useState(() => session.data as Twenty48Save)
  const initial = useRef<{ tiles: Tile[]; random: () => number } | undefined>(undefined)
  if (!initial.current) initial.current = initialTiles(gameLevel, save)
  const [tiles, setTiles] = useState<Tile[]>(() => initial.current!.tiles)
  const [problem, setProblem] = useState('')
  const [result, setResult] = useState<Result>()
  const boardRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef(save)
  const tilesRef = useRef(tiles)
  const randomRef = useRef(initial.current.random)
  const started = useRef(Date.now())
  const nextId = useRef(Math.max(0, ...tiles.map(tile => tile.id)) + 1)
  const persistRef = useRef(persist)
  persistRef.current = persist
  const writeVersion = useRef(0)
  const resolveTimer = useRef<number | undefined>(undefined)
  const flagsTimer = useRef<number | undefined>(undefined)
  const resultTimer = useRef<number | undefined>(undefined)
  saveRef.current = save
  tilesRef.current = tiles

  const currentBest = bestScore && bestScore > 0 ? bestScore : undefined
  const canPlayAgain = Boolean(launch) && !challenge && !replay

  function takeElapsed() {
    const now = Date.now()
    const elapsed = Math.min(365 * 86_400_000, saveRef.current.elapsedMs + Math.max(0, now - started.current))
    started.current = now
    return elapsed
  }

  function commit(next: Twenty48Save) {
    saveRef.current = next
    setSave(next)
    const version = ++writeVersion.current
    return persistRef.current(next).then(
      () => { if (version === writeVersion.current) setProblem('') },
      error => { if (version === writeVersion.current) setProblem(errorMessage(error)) },
    )
  }

  function checkpoint() {
    if (saveRef.current.completed) return
    void commit({ ...saveRef.current, elapsedMs: takeElapsed() })
  }

  useEffect(() => {
    boardRef.current?.focus()
  }, [])

  useEffect(() => {
    if (save.completed) return
    const timer = setInterval(checkpoint, 5000)
    const visibility = () => {
      if (document.hidden) checkpoint()
      else started.current = Date.now()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
    // checkpoint reads refs; the effect only needs to follow completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.completed])

  useEffect(() => () => {
    if (resolveTimer.current) window.clearTimeout(resolveTimer.current)
    if (flagsTimer.current) window.clearTimeout(flagsTimer.current)
    if (resultTimer.current) window.clearTimeout(resultTimer.current)
  }, [])

  function clearMotion() {
    if (resolveTimer.current) window.clearTimeout(resolveTimer.current)
    if (flagsTimer.current) window.clearTimeout(flagsTimer.current)
    resolveTimer.current = undefined
    flagsTimer.current = undefined
  }

  function move(direction: Direction) {
    const current = saveRef.current
    if (current.completed || resultTimer.current) return
    clearMotion()
    const needsSettle = tilesRef.current.some(tile =>
      tile.nextValue !== undefined || tile.removing || tile.merged || tile.spawned)
    const base = needsSettle ? settledTiles(tilesRef.current) : tilesRef.current
    if (needsSettle) {
      tilesRef.current = base
      setTiles(base)
    }
    const moved = moveTiles(base, direction)
    if (!moved.moved) return
    const elapsedMs = takeElapsed()
    const board = boardFromTiles(moved.tiles)
    const spawn = spawnTile(board, randomRef.current)
    const nextBoard = spawn.board
    const reached = current.reached2048At ?? (moved.reached2048 ? elapsedMs : undefined)
    const completed = noMoves(nextBoard)
    const next: Twenty48Save = {
      ...current,
      board: nextBoard,
      score: current.score + moved.gain,
      moves: [...current.moves, direction],
      elapsedMs,
      reached2048At: reached,
      completed,
      completedAt: completed ? Date.now() : undefined,
    }
    const nextTiles = [...moved.tiles, { ...spawn.tile, id: nextId.current++ }]
    tilesRef.current = nextTiles
    setTiles(nextTiles)
    void commit(next)
    const hasPendingMerge = nextTiles.some(tile => tile.nextValue !== undefined)
    if (hasPendingMerge) {
      resolveTimer.current = window.setTimeout(() => {
        resolveTimer.current = undefined
        setTiles(value => value.map(tile => tile.nextValue !== undefined
          ? { ...tile, value: tile.nextValue, nextValue: undefined, merged: true }
          : tile).filter(tile => !tile.removing))
        flagsTimer.current = window.setTimeout(() => {
          flagsTimer.current = undefined
          setTiles(value => value.map(tile => tile.merged || tile.spawned
            ? { ...tile, merged: false, spawned: false } : tile))
        }, popMs)
      }, resolveAfterMs)
    } else {
      flagsTimer.current = window.setTimeout(() => {
        flagsTimer.current = undefined
        setTiles(value => value.filter(tile => !tile.removing)
          .map(tile => tile.merged || tile.spawned ? { ...tile, merged: false, spawned: false } : tile))
      }, spawnDelayMs + spawnMs)
    }
    const newBest = next.score > (currentBest ?? 0)
    const finish = completed
      ? { kind: 'over' as const, score: next.score, elapsedMs, best: currentBest, newBest, moves: next.moves.length }
      : moved.reached2048 && current.reached2048At === undefined
        ? { kind: 'goal' as const, score: next.score, elapsedMs, best: currentBest, newBest, moves: next.moves.length }
        : undefined
    if (finish) {
      if (hasPendingMerge) {
        resultTimer.current = window.setTimeout(() => {
          resultTimer.current = undefined
          setResult(finish)
        }, resolveAfterMs + popMs)
      } else {
        setResult(finish)
      }
    }
  }

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const direction = keyDirections[event.key]
    if (direction === undefined) return
    event.preventDefault()
    move(direction)
  }

  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined)
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    drag.current = undefined
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0))
  }

  async function viewLeaderboard() {
    await sync?.().catch(() => undefined)
    leaderboard?.open()
  }

  function playAgain() {
    if (!launch) return
    const run = launch(quickTwenty48(randomId(), quickPlayVersion))
    void Promise.resolve(run).catch((error: unknown) => setProblem(errorMessage(error)))
  }

  const actions: CelebrationAction[] = result?.kind === 'goal' ? [
    { kind: 'primary', label: t('Keep playing'), onClick: () => setResult(undefined) },
    { kind: 'secondary', label: t('Back to menu'), onClick: finish ?? leave },
    ...(leaderboard ? [{ kind: 'secondary' as const, label: t('View leaderboard'), onClick: () => { void viewLeaderboard() } }] : []),
  ] : result?.kind === 'over' ? [
    ...(canPlayAgain
      ? [{ kind: 'primary' as const, label: t('Play again'), onClick: playAgain }]
      : [{ kind: 'primary' as const, label: t(challenge ? 'Back to challenges' : 'Back to menu'), onClick: finish ?? leave }]),
    ...(canPlayAgain
      ? [{ kind: 'secondary' as const, label: t(challenge ? 'Back to challenges' : 'Back to menu'), onClick: finish ?? leave }]
      : []),
    ...(leaderboard ? [{ kind: 'secondary' as const, label: t('View leaderboard'), onClick: () => { void viewLeaderboard() } }] : []),
  ] : []

  const finished = save.completed && !result

  return <section className="play-page twenty48-play" aria-labelledby="twenty48-title" tabIndex={0}
    style={{ '--twenty48-spawn-delay': `${spawnDelayMs}ms` } as CSSProperties}
    onKeyDown={keyboard}>
    <div className="game-navigation">
      <button className="text-button back" onClick={() => {
        if (!saveRef.current.completed) checkpoint()
        leave()
      }}><ArrowLeft size={17}/> {replay?.backLabel ?? t(challenge ? 'Back to challenges' : 'Back')}</button>
      <div className="game-nav-tools">
        {leaderboard && <button className="icon-button" aria-label={t('Leaderboard')} title={t('Leaderboard')}
          onClick={leaderboard.open}><Trophy size={18}/></button>}
      </div>
    </div>
    <div className="twenty48-heading">
      <div><p className="eyebrow">{challenge ? t('Daily challenge') : t('Classic')}</p><h1 id="twenty48-title">2048</h1></div>
      <div className="twenty48-scores">
        <div><span>{t('Score')}</span><strong>{formatScore(save.score)}</strong></div>
        <div><span>{t('Best')}</span><strong>{currentBest === undefined ? '—' : formatScore(currentBest)}</strong></div>
      </div>
    </div>
    <div className="twenty48-board-wrap">
      <div ref={boardRef} className="twenty48-board" role="group" aria-label={t('2048 board')}
        tabIndex={0} onPointerDown={pointerDown} onPointerUp={pointerUp}
        onPointerCancel={() => { drag.current = undefined }}>
        <div className="twenty48-empty" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => <span key={index}/>)}
        </div>
        {[...tiles].sort((left, right) => left.id - right.id)
          .map(tile => <div key={tile.id} className={'twenty48-tile' + (tile.merged ? ' is-merged' : '') +
          (tile.spawned ? ' is-spawned' : '') + (tile.removing ? ' is-removing' : '')} data-value={tile.value}
          style={{ left: `${tile.col * 25}%`, top: `${tile.row * 25}%` } as CSSProperties}>
          <span>{tile.value}</span>
        </div>)}
      </div>
      <p className="twenty48-hint">{t('Use the arrow keys or swipe to move the tiles.')}</p>
      {problem && <p className="error" role="alert">{t('Save failed. {detail}', { detail: knownMessage(t, problem) })}</p>}
      {finished && <section className="panel twenty48-finished" role="status">
        <h2>{t('Run complete')}</h2>
        <p>{t('Score {score} · {tiles} tiles', { score: formatScore(save.score), tiles: tileCount(save.board) })}</p>
        <div className="button-bar">
          {canPlayAgain && <button className="primary" onClick={playAgain}>{t('Play again')}</button>}
          <button className="secondary" onClick={finish ?? leave}>{t(challenge ? 'Back to challenges' : 'Back to menu')}</button>
          {leaderboard && <button className="secondary" onClick={() => { void viewLeaderboard() }}>{t('View leaderboard')}</button>}
        </div>
      </section>}
      {save.reached2048At !== undefined && <p className="badge twenty48-goal-badge">
        {t('2048 reached in {time}', { time: displayTime(save.reached2048At) })}</p>}
    </div>
    <p className="visually-hidden" aria-live="polite">
      {t('Score {score}. Highest tile {tile}. {moves} moves.', {
        score: formatScore(save.score), tile: maxTile(save.board), moves: save.moves.length,
      })}
    </p>
    {result && <CelebrationOverlay reader={reader}
      heading={result.kind === 'goal' ? t('You reached 2048!') : t('Game over')}
      result={result.kind === 'goal'
        ? { primary: { label: t('Time'), value: displayTime(result.elapsedMs) },
          description: t('Congratulations! Your time was {time}. Now let’s see what score you can reach!', { time: displayTime(result.elapsedMs) }),
          stats: [
            { label: t('Score'), value: formatScore(result.score) },
            { label: t('Moves'), value: String(result.moves) },
            { label: t('Best score'), value: result.best === undefined ? '—' : formatScore(result.best) },
          ],
          saveNote: problem ? t('Save failed. {detail}', { detail: knownMessage(t, problem) }) : t('Saved') }
        : { primary: { label: t('Score'), value: formatScore(result.score),
          best: result.best === undefined ? undefined : formatScore(result.best), newBest: result.newBest },
          stats: [
            { label: t('Time'), value: displayTime(result.elapsedMs) },
            { label: t('Highest tile'), value: String(maxTile(save.board)) },
            { label: t('Moves'), value: String(result.moves) },
          ],
          saveNote: problem ? t('Save failed. {detail}', { detail: knownMessage(t, problem) }) : t('Saved') }}
      actions={actions} celebrate={result.kind === 'goal' || result.newBest}
      onClose={() => setResult(undefined)}>{standingsPanel}</CelebrationOverlay>}
  </section>
}
