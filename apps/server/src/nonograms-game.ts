import { z } from 'zod'
import {
  nonogramMutation, nonogramPacks, nonogramsId, nonogramLevels, quickNonogram, sameNonogramLevel,
  nonogramSaveSchema, puzzleSchema, type NonogramEntry, type NonogramPack,
} from '../../../packages/nonograms/src/contracts.js'
import { matchesClues, solveByDeduction, starterPack } from '../../../packages/nonograms/src/puzzles.js'
import { HttpError } from './auth.js'
import type { ServerGame } from './game-runtime.js'

export const nonogramsServer: ServerGame = {
  id: nonogramsId,
  preferences: z.object({ favoriteNonograms: z.boolean() }),
  packs: {
    readManifest: input => nonogramPacks.manifest.parse(input),
    readDraft: input => nonogramPacks.draft.parse(input),
    verify(input) {
      const draft = nonogramPacks.draft.parse(input)
      if (!draft.puzzles.length) throw new HttpError(422, 'pack_empty')
      for (const entry of draft.puzzles)
        if (!entry.content.rows.some(runs => runs[0] > 0) || !solveByDeduction(entry.content))
          throw new HttpError(422, 'pack_puzzle_unverified', { title: entry.title })
      return nonogramPacks.published.parse(draft)
    },
    levels: pack => nonogramLevels(pack as NonogramPack),
    sameLevel: (entry, _rules, previous) => sameNonogramLevel(entry as NonogramEntry, previous as NonogramEntry),
    builtIn: [{
      id: 'nonograms-' + starterPack.id, revision: starterPack.revision, coverFile: 'cockatoos-portrait.webp',
      data: {
        format: 1, game: nonogramsId, title: starterPack.title, description: starterPack.description,
        theme: 'cockatoos', rules: { inOrder: true },
        puzzles: starterPack.puzzles.map(({ id, title, puzzle }) => ({
          levelId: 'nonograms-' + id, title, content: puzzle, ruleset: 1,
        })),
      },
    }],
  },
  readMutation: input => nonogramMutation.parse(input),
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
