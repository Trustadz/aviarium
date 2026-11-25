import { z } from 'zod'
import { GameRuleError, gameContractVersion, type GameDefinition, type StoredLevel } from '../../game-sdk/src/game.js'
import type { Difficulty } from '../../game-sdk/src/index.js'
import { difficulties } from '../../game-sdk/src/index.js'
import { builtInPacks } from './built-in-packs.js'
import { difficultySchema, preferenceSchema, quickPlayDescriptorSchema, saveSchema, quickPlayVersion, type PublishedLevel, type SudokuSave } from './contracts.js'
import type { PackDocument } from '../../game-sdk/src/packs.js'
import { gradePuzzle } from './logic.js'
import { sudoku } from './metadata.js'
import {
  authoringPack, gradedPackSchema, packDraftSchema, packLevels, packManifestSchema, packRuleset, packRulesSchema,
  sameSudokuLevel, type GradedPack, type PackDraftData, type PackRules, type PublishedPack,
} from './packs.js'
import { rulesFor } from './rules.js'
import { createSave } from './save.js'
import { quickPlayId, quickPlayLevel } from './seed-code.js'
import { validate } from './solver.js'
import { generateQuickPuzzle } from './quick-play.js'
import {
  parseSudokuBoard, sudokuBoardKey, sudokuLeaderboardRulesVersion, sudokuPuzzleContent, sudokuQuickBoards, sudokuSeedCode,
} from './leaderboards.js'

const defaultRules: PackRules = {
  inOrder: false, hints: true, autoNotes: true, lives: null, timeTrial: false, diagonal: false,
}
const difficultyGroup = {
  key: 'difficulty',
  label: 'Difficulty',
  kind: 'generation' as const,
  choices: difficulties.map(difficulty => ({ id: difficulty, label: difficulty, value: difficulty })),
  defaultEnabled: ['Easy', 'Medium', 'Hard'],
}

type SudokuEntry = PackDraftData['puzzles'][number]
type QuickPlayOptions = { difficulty: Difficulty }

export function verifySudokuPack(input: unknown, prior: readonly StoredLevel[] = []): GradedPack {
  const draft = authoringPack(packDraftSchema.parse(input))
  const known = new Map(prior.map(level => [level.id, level]))
  if (!draft.puzzles.length) throw new GameRuleError('pack_empty')
  const puzzles = draft.puzzles.map(puzzle => {
    const ruleset = packRuleset({ ...draft.rules, ...puzzle.rules })
    const diagonal = ruleset === 2
    const previous = puzzle.levelId && known.get(puzzle.levelId)
    if (previous && previous.grid === puzzle.grid && previous.ruleset === ruleset)
      return { ...puzzle, ruleset, difficulty: previous.difficulty ?? 'Medium' }
    const grid = Array.from(puzzle.grid, Number)
    if (validate(grid, 65_000, diagonal).kind !== 'unique')
      throw new GameRuleError('pack_puzzle_unverified', { title: puzzle.title })
    const { difficulty } = gradePuzzle(grid, diagonal)
    if (!difficulty) throw new GameRuleError('pack_puzzle_review', { title: puzzle.title })
    return { ...puzzle, ruleset, difficulty }
  })
  return gradedPackSchema.parse({ ...draft, puzzles })
}

export function validateSudokuAttempt(input: unknown, level: StoredLevel, rules?: PackRules) {
  const save = saveSchema.parse(input)
  const limit = rules?.lives
  const lives = save.lives
  if (limit ? lives === undefined || lives > limit || (lives === 0 && save.completed) : lives !== undefined)
    throw new GameRuleError('lives_rule_mismatch')
  const givens = Array.from(level.grid ?? '', Number)
  for (const board of [save.board, ...save.undo, ...save.redo]) {
    if (givens.some((given, cell) => given && board.entries[cell] !== given))
      throw new GameRuleError('fixed_digits_changed')
  }
  if (save.completed && !rulesFor(level.ruleset === 2).verify(givens, save.board.entries))
    throw new GameRuleError('saved_solution_invalid')
}

/**
 * Sudoku's complete game definition. The platform owns packs, boards, saves and
 * challenges; Sudoku supplies its level/attempt codec, generator, result and
 * player/editor presentation.
 */
export const sudokuGame: GameDefinition<PublishedLevel, SudokuSave, PackRules, QuickPlayOptions> = {
  contractVersion: gameContractVersion,
  id: sudoku.id,
  meta: sudoku,
  preferences: preferenceSchema,
  play: {
    save: {
      schema: saveSchema,
      create: (level, context) => createSave(level, context.pack as PublishedPack | undefined),
      validate: (attempt, level, context) => validateSudokuAttempt(attempt, level, context.rules),
    },
    rules: { schema: packRulesSchema, defaults: defaultRules },
  },
  generation: {
    version: quickPlayVersion,
    quickPlay: quickPlayDescriptorSchema,
    describe(level) {
      const parsed = quickPlayDescriptorSchema.safeParse({ seed: level.seed, difficulty: level.difficulty,
        version: level.generatorVersion })
      return level.source === 'Generated' && parsed.success ? { quickPlay: parsed.data } : undefined
    },
    options: {
      schema: z.object({ difficulty: difficultySchema }),
      defaults: { difficulty: 'Medium' },
      fields: [{ key: 'difficulty', label: 'Difficulty',
        choices: difficulties.map(difficulty => ({ value: difficulty, label: difficulty })) }],
    },
    generate: async (seed, options) => ({
      ruleset: 1, title: 'Quick Play', difficulty: options.difficulty,
      grid: generateQuickPuzzle(seed, options.difficulty), rules: {}, generatorVersion: quickPlayVersion,
    }),
    materialize: async (seed, options, content) => {
      const descriptor = { seed, difficulty: options.difficulty, version: quickPlayVersion as typeof quickPlayVersion }
      return quickPlayLevel(await quickPlayId(descriptor), content.grid ?? '', descriptor)
    },
  },
  packs: {
    schemas: {
      manifest: packManifestSchema as unknown as z.ZodType<PackDocument>,
      draft: packDraftSchema as unknown as z.ZodType<PackDocument>,
      published: gradedPackSchema as unknown as z.ZodType<PackDocument>,
    },
    builtIn: builtInPacks,
    verify: async (pack, prior) => verifySudokuPack(pack, prior),
    materialize: pack => packLevels(pack as PublishedPack),
    sameContent: (entry, rules, prior, priorRules) =>
      sameSudokuLevel(entry as SudokuEntry, rules, prior as SudokuEntry, priorRules),
  },
  leaderboard: {
    quickBoards: sudokuQuickBoards,
    board: sudokuBoardKey,
    parseBoard: parseSudokuBoard,
    result: (level, attempt) => {
      const save = saveSchema.parse(attempt)
      return {
        value: save.elapsedMs, unit: 'ms', lowerIsBetter: true,
        aids: save.hintsUsed === undefined ? save.aids : { ...save.aids, hintsUsed: save.hintsUsed },
        rulesVersion: sudokuLeaderboardRulesVersion, puzzleContent: sudokuPuzzleContent(level),
        seedCode: sudokuSeedCode(level),
      }
    },
  },
  challenge: {
    options: { difficulty: 'Medium' },
    rules: defaultRules,
    optionGroups: [difficultyGroup],
  },
}
