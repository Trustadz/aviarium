import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { builtInPacks } from '../../../packages/sudoku/src/built-in-packs.js'
import { mutationSchema, preferenceSchema, quickPlayDescriptorSchema, quickPlayVersion, saveSchema, type QuickPlayDescriptor } from '../../../packages/sudoku/src/contracts.js'
import { gradePuzzle } from '../../../packages/sudoku/src/logic.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { authoringPack, gradedPackSchema, packDraftSchema, packLevels, packManifestSchema, packRuleset, sameSudokuLevel } from '../../../packages/sudoku/src/packs.js'
import type { PackDraftData, PackRules, PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { rulesFor } from '../../../packages/sudoku/src/rules.js'
import { quickPlayId } from '../../../packages/sudoku/src/seed-code.js'
import { validate } from '../../../packages/sudoku/src/solver.js'
import {
  parseSudokuBoard, sudokuBoardKey, sudokuLeaderboardRulesVersion, sudokuPuzzleContent, sudokuQuickBoards, sudokuSeedCode,
} from '../../../packages/sudoku/src/leaderboards.js'
import { HttpError, requireUser } from './auth.js'
import { loginEnabled, pool, testEnvironment } from './config.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'
import { registerLevels } from './levels.js'
import { getQuickPlayLevel } from './quick-play.js'

export function verifySudokuPack(input: unknown, prior: readonly LevelRecord[] = []) {
  const draft = authoringPack(packDraftSchema.parse(input))
  const known = new Map(prior.map(level => [level.id, level]))
  if (!draft.puzzles.length) throw new HttpError(422, 'pack_empty')
  const puzzles = draft.puzzles.map(puzzle => {
    const ruleset = packRuleset({ ...draft.rules, ...puzzle.rules })
    const diagonal = ruleset === 2
    const previous = puzzle.levelId && known.get(puzzle.levelId)
    if (previous && previous.grid === puzzle.grid && previous.ruleset === ruleset)
      return { ...puzzle, ruleset, difficulty: previous.difficulty }
    const grid = Array.from(puzzle.grid, Number)
    if (validate(grid, 65_000, diagonal).kind !== 'unique')
      throw new HttpError(422, 'pack_puzzle_unverified', { title: puzzle.title })
    const { difficulty } = gradePuzzle(grid, diagonal)
    if (!difficulty) throw new HttpError(422, 'pack_puzzle_review', { title: puzzle.title })
    return { ...puzzle, ruleset, difficulty }
  })
  return gradedPackSchema.parse({ ...draft, puzzles })
}

type SudokuEntry = PackDraftData['puzzles'][number]
export const sudokuServer: ServerGame = {
  id: sudoku.id,
  preferences: preferenceSchema,
  packs: {
    readManifest: input => packManifestSchema.parse(input),
    readDraft: input => packDraftSchema.parse(input),
    verify: verifySudokuPack,
    levels: pack => packLevels(pack as PublishedPack),
    sameLevel: (entry, rules, old, oldRules) =>
      sameSudokuLevel(entry as SudokuEntry, rules as PackRules, old as SudokuEntry, oldRules as PackRules),
    builtIn: builtInPacks,
  },
  readMutation: input => mutationSchema.parse(input),
  leaderboards: {
    quickBoards: sudokuQuickBoards,
    boardKey: sudokuBoardKey,
    parseBoard: parseSudokuBoard,
    record(level, save, packTitle) {
      const data = saveSchema.parse(save)
      const board = sudokuBoardKey(level)
      return {
        boardKey: board.key, boardKind: board.kind, boardMeta: board.meta,
        puzzleContent: sudokuPuzzleContent(level),
        value: data.elapsedMs, unit: 'ms', lowerIsBetter: true,
        levelTitle: level.title, packTitle, seedCode: sudokuSeedCode(level),
        aids: data.aids, rulesVersion: sudokuLeaderboardRulesVersion,
      }
    },
  },
  async resolveGeneratedLevel(db, input) {
    const mutation = mutationSchema.parse(input)
    if (mutation.quickPlay && mutation.data.levelRevision === 1 &&
        await quickPlayId(mutation.quickPlay) === mutation.data.level)
      return getQuickPlayLevel(db, mutation.data.level, mutation.quickPlay)
  },
  validateAttempt(input, level, packRules) {
    const save = saveSchema.parse(input)
    const limit = (packRules as PackRules | undefined)?.lives
    const lives = save.lives
    if (limit ? lives === undefined || lives > limit || (lives === 0 && save.completed) : lives !== undefined)
      throw new HttpError(422, 'lives_rule_mismatch')
    const givens = Array.from(level.grid ?? '', Number)
    for (const board of [save.board, ...save.undo, ...save.redo]) {
      if (givens.some((given, cell) => given && board.entries[cell] !== given))
        throw new HttpError(422, 'fixed_digits_changed')
    }
    if (save.completed && !rulesFor(level.ruleset === 2).verify(givens, save.board.entries))
      throw new HttpError(422, 'saved_solution_invalid')
  },
  routes(app) {
    registerLevels(app)
    app.post('/api/sudoku/quick-play', async request => {
      if (loginEnabled || testEnvironment) await requireUser(request)
      const input = quickPlayDescriptorSchema.partial({ seed: true, version: true }).parse(request.body)
      const descriptor: QuickPlayDescriptor = { difficulty: input.difficulty, seed: input.seed ?? randomBytes(8).toString('hex'), version: quickPlayVersion }
      return getQuickPlayLevel(pool, await quickPlayId(descriptor), descriptor)
    })
    app.get('/api/sudoku/level/:id/:revision', async request => {
      if (loginEnabled || testEnvironment) await requireUser(request)
      const { id, revision } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/),
        revision: z.coerce.number().int().positive() }).parse(request.params)
      const { rows: [level] } = await pool.query<LevelRecord>(`SELECT l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,
        l.source,l.seed,l.generator_version AS "generatorVersion" FROM published_levels l
        WHERE l.id=$1 AND l.revision=$2 AND l.game_id=$3 AND l.catalog_visible
          AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)`, [id, revision, sudoku.id])
      if (!level) throw new HttpError(404, 'puzzle_revision_unavailable')
      return level
    })
  },
}
