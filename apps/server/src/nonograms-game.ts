import { z } from 'zod'
import {
  nonogramMutation, nonogramPacks, nonogramsId, nonogramLevels, quickNonogram, sameNonogramLevel,
  nonogramSaveSchema, puzzleSchema, type NonogramEntry, type NonogramPack,
} from '../../../packages/nonograms/src/contracts.js'
import { matchesClues, solveByDeduction, starterPack } from '../../../packages/nonograms/src/puzzles.js'
import {
  nonogramBoardKey, nonogramLeaderboardRulesVersion, nonogramPuzzleContent, nonogramQuickBoards, parseNonogramBoard,
} from '../../../packages/nonograms/src/leaderboards.js'
import { HttpError } from './auth.js'
import { upgradePackDocument } from '../../../packages/game-sdk/src/packs.js'
import type { ServerGame } from './game-runtime.js'

export const nonogramsServer: ServerGame = {
  id: nonogramsId,
  preferences: z.object({ favoriteNonograms: z.boolean(), nonogramTimer: z.boolean() }),
  packs: {
    readManifest: input => nonogramPacks.manifest.parse(input),
    readDraft: input => nonogramPacks.draft.parse(input),
    verify(input) {
      const draft = nonogramPacks.draft.parse(upgradePackDocument(input))
      if (!draft.chapters.some(chapter => chapter.puzzles.length)) throw new HttpError(422, 'pack_empty')
      for (const chapter of draft.chapters) {
        if (!chapter.puzzles.length) throw new HttpError(422, 'pack_chapter_empty', { chapter: chapter.title })
        for (const entry of chapter.puzzles)
          if (!entry.content.rows.some(runs => runs[0] > 0) || !solveByDeduction(entry.content))
            throw new HttpError(422, 'pack_puzzle_unverified', { title: entry.title })
      }
      return nonogramPacks.published.parse(draft)
    },
    levels: pack => nonogramLevels(pack as NonogramPack),
    sameLevel: (entry, _rules, previous) => sameNonogramLevel(entry as NonogramEntry, previous as NonogramEntry),
    builtIn: [{
      id: 'nonograms-' + starterPack.id, revision: starterPack.revision, coverFile: 'cockatoos-portrait.webp',
      data: {
        format: 2, game: nonogramsId, title: starterPack.title, description: starterPack.description,
        chapters: [{
          id: 'chapter-1', title: starterPack.title, description: starterPack.description,
          theme: 'cockatoos', rules: { inOrder: true },
          puzzles: starterPack.puzzles.map(({ id, title, puzzle }) => ({
            levelId: 'nonograms-' + id, title, content: puzzle, ruleset: 1,
          })),
        }],
      },
    }],
  },
  readMutation: input => nonogramMutation.parse(input),
  leaderboards: {
    quickBoards: nonogramQuickBoards,
    boardKey: level => nonogramBoardKey({ ...level, content: puzzleSchema.parse(level.content) }),
    parseBoard: parseNonogramBoard,
    record(level, save, packTitle) {
      const data = nonogramSaveSchema.parse(save)
      const content = puzzleSchema.parse(level.content)
      const board = nonogramBoardKey({ ...level, content })
      return {
        boardKey: board.key, boardKind: board.kind, boardMeta: board.meta,
        puzzleContent: nonogramPuzzleContent(content),
        value: data.elapsedMs, unit: 'ms', lowerIsBetter: true,
        levelTitle: level.title, packTitle, rulesVersion: nonogramLeaderboardRulesVersion,
      }
    },
  },
  async resolveGeneratedLevel(db, input) {
    const { data, quickPlay } = nonogramMutation.parse(input)
    if (!quickPlay || data.levelRevision !== 1 || data.packRevision !== undefined) return
    const level = await quickNonogram(quickPlay)
    if (!level || level.id !== data.level) return
    await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,difficulty,source,seed,generator_version,
      validation,catalog_visible,game_id,content) VALUES($1,1,1,$2,$3,'Generated',$4,$5,'unique',false,$6,$7)
      ON CONFLICT(id,revision) DO NOTHING`,
    [level.id, level.title, level.difficulty, level.seed, level.generatorVersion, nonogramsId, JSON.stringify(level.content)])
    return level
  },
  validateAttempt(input, level) {
    const save = nonogramSaveSchema.parse(input)
    const puzzle = puzzleSchema.parse(level.content)
    const length = puzzle.rows.length * puzzle.columns.length
    if ([save.board, ...save.undo].some(board => board.length !== length) ||
        save.completed !== matchesClues(puzzle, save.board))
      throw new HttpError(422, 'saved_solution_invalid')
  },
  routes() {},
}
