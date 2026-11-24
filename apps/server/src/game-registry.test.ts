import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { GameRuleError, gameContractVersion, type GameDefinition } from '../../../packages/game-sdk/src/game.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { PackDocument } from '../../../packages/game-sdk/src/packs.js'
import { sudokuGame } from '../../../packages/sudoku/src/game.js'
import { nonogramsGame } from '../../../packages/nonograms/src/game.js'
import { createGameRegistry } from './game-registry.js'

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

const fixture: GameDefinition<GameLevel, FixtureSave, Record<string, never>, { difficulty: string }> = {
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
    options: { schema: z.object({ difficulty: z.string() }), defaults: { difficulty: 'normal' },
      fields: [{ key: 'difficulty', label: 'Difficulty', choices: [{ value: 'normal', label: 'Normal' }] }] },
    generate: async (_seed, options) => ({ ruleset: 1, title: 'Fixture', difficulty: options.difficulty,
      content: { answer: 1 }, rules: {}, generatorVersion: 1 }),
    materialize: (seed, _options, _content) => ({
      id: 'fixture-' + seed, revision: 1, ruleset: 1, title: 'Fixture', source: 'Generated',
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
}

test('a new game is added through one definition and becomes discoverable', () => {
  const registry = createGameRegistry([sudokuGame, nonogramsGame, fixture])
  assert.deepEqual(registry.all().map(game => game.definition.id), ['sudoku', 'nonograms', 'fixture'])
  assert.equal(registry.get('fixture')?.definition.meta.title, 'Fixture')
  assert.deepEqual(registry.challengeCapable().map(game => game.definition.id), ['sudoku', 'nonograms', 'fixture'])
})

test('registry validation rejects duplicate ids and malformed definitions', () => {
  assert.throws(() => createGameRegistry([sudokuGame, sudokuGame]), /duplicate game id/)
  assert.throws(() => createGameRegistry([{ ...fixture, contractVersion: 99 } as unknown as typeof fixture]),
    /unsupported contract version/)
})
