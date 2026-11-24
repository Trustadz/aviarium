import type { ChallengeGameRuntime } from './types.js'
import { nonogramSaveSchema, quickNonogram, type NonogramLevel } from '../../../../packages/nonograms/src/contracts.js'
import { nonogramLeaderboardRulesVersion, nonogramPuzzleContent } from '../../../../packages/nonograms/src/leaderboards.js'

const sizeGroup = {
  key: 'size',
  label: 'Grid size',
  kind: 'generation' as const,
  choices: [5, 10].map(size => ({ id: String(size), label: String(size) + ' × ' + String(size), value: size })),
  defaultEnabled: ['10'],
}
const difficultyGroup = {
  key: 'difficulty',
  label: 'Difficulty',
  kind: 'generation' as const,
  choices: ['Easy', 'Medium', 'Hard'].map(difficulty => ({ id: difficulty, label: difficulty, value: difficulty })),
  defaultEnabled: ['Easy', 'Medium', 'Hard'],
}

/** Nonograms' challenge adapter; the platform owns the schedule and board. */
export const nonogramsChallenge: ChallengeGameRuntime = {
  id: 'nonograms',
  label: 'Nonograms',
  optionGroups: [sizeGroup, difficultyGroup],
  async generate(recipe) {
    const size = Number(recipe.selection.options.size)
    const difficulty = recipe.selection.options.difficulty
    if ((size !== 5 && size !== 10) || (difficulty !== 'Easy' && difficulty !== 'Medium' && difficulty !== 'Hard'))
      throw new Error('challenge_options_invalid')
    const level = await quickNonogram({ seed: recipe.seed, size, difficulty, version: 1 })
    if (!level) throw new Error('challenge_generation_failed')
    return {
      ruleset: 1,
      title: 'Daily challenge',
      difficulty,
      content: level.content,
      rules: {},
      generatorVersion: level.generatorVersion ?? 1,
    }
  },
  record(level, attempt) {
    const save = nonogramSaveSchema.parse(attempt)
    return {
      value: save.elapsedMs,
      unit: 'ms',
      lowerIsBetter: true,
      rulesVersion: nonogramLeaderboardRulesVersion,
      puzzleContent: nonogramPuzzleContent((level as NonogramLevel).content),
    }
  },
}
