import { nonogramsChallenge } from './nonograms.js'
import { sudokuChallenge } from './sudoku.js'
import type { ChallengeGameRuntime } from './types.js'

/**
 * Registered challenge-capable games. Adding a game is a module plus its
 * registration; the scheduler and board code never name Sudoku or Nonograms.
 */
export const challengeGames: readonly ChallengeGameRuntime[] = [sudokuChallenge, nonogramsChallenge]
