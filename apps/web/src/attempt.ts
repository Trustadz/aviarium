import type { GameAttempt } from '../../../packages/game-sdk/src/progress.js'

const unwatched = new Set(['elapsedMs', 'completedAt', 'aids'])

/**
 * A fresh level still writes time checkpoints. Only a real move, hint, life
 * loss, completion, or other game-specific change should create a saved attempt.
 * Player aids are settings; the Sudoku player adds them on every persist.
 */
export function isUntouched(initial: GameAttempt, next: GameAttempt) {
  const comparable = (attempt: GameAttempt) => JSON.stringify(Object.fromEntries(
    Object.entries(attempt).filter(([key]) => !unwatched.has(key)),
  ))
  return comparable(initial) === comparable(next)
}
