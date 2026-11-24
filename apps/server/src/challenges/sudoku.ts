import type { Difficulty } from '../../../../packages/game-sdk/src/index.js'
import { difficulties } from '../../../../packages/game-sdk/src/index.js'
import { quickPlayVersion, saveSchema } from '../../../../packages/sudoku/src/contracts.js'
import { generateQuickPuzzle } from '../../../../packages/sudoku/src/quick-play.js'
import { sudokuLeaderboardRulesVersion, sudokuPuzzleContent } from '../../../../packages/sudoku/src/leaderboards.js'
import type { ChallengeGameRuntime } from './types.js'

const difficultyGroup = {
  key: 'difficulty',
  label: 'Difficulty',
  kind: 'generation' as const,
  choices: difficulties.map(difficulty => ({ id: difficulty, label: difficulty, value: difficulty })),
  defaultEnabled: ['Easy', 'Medium', 'Hard'],
}

/**
 * Sudoku's challenge adapter. The game supplies generation, verification and
 * result interpretation; the platform owns scheduling, attempts, boards and
 * history. No challenge code is needed inside the Sudoku player.
 */
export const sudokuChallenge: ChallengeGameRuntime = {
  id: 'sudoku',
  label: 'Sudoku',
  optionGroups: [difficultyGroup],
  async generate(recipe) {
    const difficulty = recipe.selection.options.difficulty
    if (typeof difficulty !== 'string' || !difficulties.includes(difficulty as Difficulty))
      throw new Error('challenge_difficulty_invalid')
    const grid = generateQuickPuzzle(recipe.seed, difficulty as Difficulty)
    return {
      ruleset: 1,
      title: 'Daily challenge',
      difficulty,
      grid,
      rules: {},
      generatorVersion: quickPlayVersion,
    }
  },
  record(level, attempt) {
    const save = saveSchema.parse(attempt)
    return {
      value: save.elapsedMs,
      unit: 'ms',
      lowerIsBetter: true,
      aids: save.aids,
      rulesVersion: sudokuLeaderboardRulesVersion,
      puzzleContent: sudokuPuzzleContent(level),
    }
  },
}
