import type {
  ChallengeGeneratedLevel, ChallengeOptionGroup, ChallengeResult,
} from '../../../../packages/game-sdk/src/challenges.js'
import type { GameDefinition } from '../../../../packages/game-sdk/src/game.js'
import type { ChallengeGameRuntime } from './types.js'

/**
 * Build a challenge capability from a GameDefinition. The game already declares
 * how to generate a level, interpret a result and expose option groups; the
 * platform adds scheduling, attempts, boards and history. A new game is
 * challenge-capable by supplying `generation` and `leaderboard`, with no
 * challenge-specific adapter.
 */
export function challengeGameFromDefinition(
  definition: GameDefinition<any, any, any, any>,
): ChallengeGameRuntime | undefined {
  if (!definition.generation || !definition.leaderboard) return undefined
  const generation = definition.generation
  const optionGroups: ChallengeOptionGroup[] = definition.challenge?.optionGroups
    ? definition.challenge.optionGroups.map(group => ({
        key: group.key, label: group.label, kind: group.kind,
        choices: group.choices.map(choice => ({ id: choice.id, label: choice.label, value: choice.value })),
        defaultEnabled: group.defaultEnabled,
      }))
    : generation.options.fields.map(field => ({
        key: field.key, label: field.label, kind: 'generation' as const,
        choices: field.choices.map(choice => ({
          id: String(choice.value), label: choice.label, value: choice.value,
        })),
        defaultEnabled: field.choices.map(choice => String(choice.value)),
      }))
  return {
    id: definition.id,
    label: definition.meta.title,
    optionGroups,
    async generate(recipe) {
      const options = generation.options.schema.parse(recipe.selection.options)
      const generated = await generation.generate(recipe.seed, options)
      if (!generated) throw new Error('challenge_generation_failed')
      if (generation.verify) await generation.verify(generated, options as never)
      const result: ChallengeGeneratedLevel = {
        ruleset: generated.ruleset, title: 'Daily challenge', difficulty: generated.difficulty,
        grid: generated.grid ?? undefined, content: generated.content, rules: recipe.selection.rules,
        generatorVersion: generated.generatorVersion,
      }
      return result
    },
    record(level, attempt, rules): ChallengeResult {
      const result = definition.leaderboard!.result(level as never, attempt as never, rules as never)
      return {
        value: result.value, unit: result.unit, lowerIsBetter: result.lowerIsBetter,
        aids: result.aids, rulesVersion: result.rulesVersion, puzzleContent: result.puzzleContent,
      }
    },
  }
}
