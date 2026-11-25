import { z } from 'zod'
import { GameRuleError, gameContractVersion, type GameDefinition, type StoredLevel } from '../../game-sdk/src/game.js'
import type { PackDocument, ProgressionRules } from '../../game-sdk/src/packs.js'
import { nonogramBuiltInPacks } from './built-in-packs.js'
import {
  createNonogramAttempt, gridSizeSchema, nonogramLevels, nonogramPacks, nonogramsId, nonogramSaveSchema,
  puzzleSchema, quickDescriptor, quickNonogram, sameNonogramLevel, type NonogramEntry, type NonogramLevel, type NonogramPack,
  type NonogramSave,
} from './contracts.js'
import { nonograms } from './metadata.js'
import { matchesClues, randomDifficulties, randomSizes, solveByDeduction, type Puzzle } from './puzzles.js'
import {
  nonogramBoardKey, nonogramLeaderboardRulesVersion, nonogramPuzzleContent, nonogramQuickBoards, parseNonogramBoard,
} from './leaderboards.js'

type NonogramOptions = { size: 5 | 10; difficulty: 'Easy' | 'Medium' | 'Hard' }
const defaultRules: ProgressionRules = { inOrder: false }
const settingGroup = (key: string, label: string, on: boolean) => ({
  key, label, kind: 'rule' as const,
  choices: [{ id: 'on', label: 'On', value: true }, { id: 'off', label: 'Off', value: false }],
  defaultEnabled: [on ? 'on' : 'off'],
})
const challengeSettingGroups = [settingGroup('nonogramTimer', 'Show timer', true)]
const sizeGroup = {
  key: 'size',
  label: 'Grid size',
  kind: 'generation' as const,
  choices: randomSizes.map(size => ({ id: String(size), label: String(size) + ' × ' + String(size), value: size })),
  defaultEnabled: ['10'],
}
const difficultyGroup = {
  key: 'difficulty',
  label: 'Difficulty',
  kind: 'generation' as const,
  choices: randomDifficulties.map(difficulty => ({ id: difficulty, label: difficulty, value: difficulty })),
  defaultEnabled: ['Easy', 'Medium', 'Hard'],
}

export function verifyNonogramPack(input: unknown, _prior: readonly StoredLevel[] = []): PackDocument {
  const draft = nonogramPacks.draft.parse(input)
  if (!draft.puzzles.length) throw new GameRuleError('pack_empty')
  for (const entry of draft.puzzles)
    if (!entry.content.rows.some(runs => runs[0] > 0) || !solveByDeduction(entry.content))
      throw new GameRuleError('pack_puzzle_unverified', { title: entry.title })
  return nonogramPacks.published.parse(draft) as PackDocument
}

export function validateNonogramAttempt(input: unknown, level: StoredLevel) {
  const save = nonogramSaveSchema.parse(input)
  const puzzle = puzzleSchema.parse(level.content)
  const length = puzzle.rows.length * puzzle.columns.length
  if ([save.board, ...save.undo].some(board => board.length !== length) ||
      save.completed !== matchesClues(puzzle, save.board))
    throw new GameRuleError('saved_solution_invalid')
}

/** Nonograms' complete game definition; the platform owns packs, boards and challenges. */
export const nonogramsGame: GameDefinition<NonogramLevel, NonogramSave, ProgressionRules, NonogramOptions> = {
  contractVersion: gameContractVersion,
  id: nonograms.id,
  meta: nonograms,
  preferences: z.object({ favoriteNonograms: z.boolean(), nonogramTimer: z.boolean() }),
  play: {
    save: {
      schema: nonogramSaveSchema,
      create: (level, context) => createNonogramAttempt(level, context.pack as NonogramPack | undefined),
      validate: (attempt, level) => validateNonogramAttempt(attempt, level),
    },
    rules: { schema: z.object({ inOrder: z.boolean() }), defaults: defaultRules },
  },
  generation: {
    version: 1,
    quickPlay: quickDescriptor,
    describe(level) {
      const parsed = quickDescriptor.safeParse({ seed: level.seed, size: level.content.rows.length,
        difficulty: level.difficulty, version: level.generatorVersion })
      return level.source === 'Generated' && parsed.success ? { quickPlay: parsed.data } : undefined
    },
    options: {
      schema: z.object({ size: gridSizeSchema, difficulty: z.enum(randomDifficulties) }),
      defaults: { size: 10, difficulty: 'Medium' },
      fields: [
        { key: 'size', label: 'Grid size', choices: randomSizes.map(size => ({ value: size, label: size + ' × ' + size })) },
        { key: 'difficulty', label: 'Difficulty', choices: randomDifficulties.map(difficulty => ({ value: difficulty, label: difficulty })) },
      ],
    },
    generate: async (seed, options) => {
      const level = await quickNonogram({ ...options, seed, version: 1 })
      if (!level) return undefined
      return { ruleset: 1, title: level.title, difficulty: level.difficulty, content: level.content,
        rules: {}, generatorVersion: level.generatorVersion ?? 1 }
    },
    materialize: async (seed, options, _content) => {
      const level = await quickNonogram({ ...options, seed, version: 1 })
      if (!level) throw new GameRuleError('challenge_generation_failed')
      return level
    },
  },
  packs: {
    schemas: {
      manifest: nonogramPacks.manifest as unknown as z.ZodType<PackDocument>,
      draft: nonogramPacks.draft as unknown as z.ZodType<PackDocument>,
      published: nonogramPacks.published as unknown as z.ZodType<PackDocument>,
    },
    builtIn: nonogramBuiltInPacks,
    verify: async (pack, prior) => verifyNonogramPack(pack, prior),
    materialize: pack => nonogramLevels(pack as NonogramPack),
    sameContent: (entry, _rules, prior) => sameNonogramLevel(entry as NonogramEntry, prior as NonogramEntry),
  },
  leaderboard: {
    quickBoards: nonogramQuickBoards,
    board: nonogramBoardKey,
    parseBoard: parseNonogramBoard,
    result: (level, attempt) => {
      const save = nonogramSaveSchema.parse(attempt)
      return {
        value: save.elapsedMs, unit: 'ms', lowerIsBetter: true,
        rulesVersion: nonogramLeaderboardRulesVersion,
        puzzleContent: nonogramPuzzleContent(level.content as Puzzle),
      }
    },
  },
  challenge: {
    options: { size: 10, difficulty: 'Medium' },
    rules: defaultRules,
    optionGroups: [sizeGroup, difficultyGroup, ...challengeSettingGroups],
  },
}
