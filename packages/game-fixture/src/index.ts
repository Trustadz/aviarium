import { z } from 'zod'
import {
  GameRuleError, gameContractVersion, type GameDefinition,
} from '../../game-sdk/src/game.js'
import type { GameLevel } from '../../game-sdk/src/index.js'
import type { PackDocument } from '../../game-sdk/src/packs.js'

const packSchema = z.object({
  format: z.literal(1), game: z.literal('fixture'), title: z.string(), description: z.string(),
  theme: z.string(), rules: z.object({ inOrder: z.boolean() }),
  puzzles: z.array(z.object({ title: z.string(), ruleset: z.number() })),
})
const saveSchema = z.object({
  game: z.literal('fixture'), level: z.string(), levelRevision: z.number(), ruleset: z.number(),
  format: z.number(), elapsedMs: z.number(), completed: z.boolean(),
})
type FixtureSave = z.infer<typeof saveSchema>
const optionGroup = {
  key: 'difficulty', label: 'Difficulty', kind: 'generation' as const,
  choices: [{ id: 'normal', label: 'Normal', value: 'normal' }], defaultEnabled: ['normal'],
}

/**
 * A package-backed third game. It exists to prove that a GameDefinition alone
 * can travel through the platform map, save/pack/leaderboard code and the
 * challenge derivation without editing a platform module.
 */
export const fixtureGame: GameDefinition<GameLevel, FixtureSave, Record<string, never>, { difficulty: string }> = {
  contractVersion: gameContractVersion,
  id: 'fixture',
  meta: {
    id: 'fixture', title: 'Fixture', description: 'A test-only game.', tags: ['Test'],
    eReader: false, input: ['keyboard'],
  },
  play: {
    save: {
      schema: saveSchema,
      create: level => ({ game: 'fixture', level: level.id, levelRevision: level.revision, ruleset: 1,
        format: 1, elapsedMs: 0, completed: false }),
      validate: save => { if (!save.completed) throw new GameRuleError('fixture_incomplete') },
    },
    rules: { schema: z.object({}), defaults: {} },
  },
  generation: {
    version: 1,
    quickPlay: z.object({ seed: z.string(), difficulty: z.string(), version: z.literal(1) }),
    options: { schema: z.object({ difficulty: z.string() }), defaults: { difficulty: 'normal' },
      fields: [{ key: 'difficulty', label: 'Difficulty', choices: [{ value: 'normal', label: 'Normal' }] }] },
    generate: async (_seed, options) => ({ ruleset: 1, title: 'Fixture', difficulty: options.difficulty,
      content: { answer: 1 }, rules: {}, generatorVersion: 1 }),
    materialize: (seed, _options, _content) => ({
      id: 'fixture-' + seed, revision: 1, ruleset: 1, title: 'Fixture', source: 'Generated',
      content: { answer: 1 },
    }),
  },
  packs: {
    schemas: {
      manifest: packSchema as unknown as z.ZodType<PackDocument>,
      draft: packSchema as unknown as z.ZodType<PackDocument>,
      published: packSchema as unknown as z.ZodType<PackDocument>,
    },
    builtIn: [],
    verify: async pack => pack,
    materialize: () => [],
  },
  leaderboard: {
    result: (level, save) => ({ value: save.elapsedMs, unit: 'ms', lowerIsBetter: true, rulesVersion: 1,
      puzzleContent: level.id }),
  },
  challenge: { options: { difficulty: 'normal' }, rules: {}, optionGroups: [optionGroup] },
}
