import { sudokuChallenge } from './sudoku.js'
import type { ChallengeGameRuntime } from './types.js'

/**
 * Registered challenge-capable games. Adding a game is a module plus its
 * registration; the scheduler and board code never name Sudoku or Nonograms.
 * Nonograms joins in the next slice.
 */
export const challengeGames: readonly ChallengeGameRuntime[] = [sudokuChallenge]
