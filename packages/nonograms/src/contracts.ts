import { z } from 'zod'
import type { GameLevel } from '../../game-sdk/src/index.js'
import { definePackSchemas, packLevelFields, packLevelId, progressionRules, type PackRevision } from '../../game-sdk/src/packs.js'
import { attemptIdentity, attemptOutcome, attemptPlayOptions, challengeMutationField, mutationHeader, packRevisionField, type PlayOptions } from '../../game-sdk/src/progress.js'
import { fromPicture, randomDifficulties, randomPuzzle, type Cell, type Puzzle } from './puzzles.js'
import { sha256 } from '../../game-sdk/src/sha256.js'

export const nonogramsId = 'nonograms'
export const gridSizeSchema = z.union([z.literal(5), z.literal(10)])
const line = z.array(z.number().int().min(0).max(10)).min(1).max(5)
const lines = z.array(line).max(10)
export const puzzleSchema = z.object({ rows: lines, columns: lines }).refine(({ rows, columns }) =>
  gridSizeSchema.safeParse(rows.length).success && rows.length === columns.length &&
  [...rows, ...columns].every(runs => (runs.length === 1 && runs[0] === 0) ||
    (runs.every(run => run > 0) && runs.reduce((sum, run) => sum + run, runs.length - 1) <= rows.length)))

const marksSchema = z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).max(100)
export const nonogramSaveSchema = z.object({
  ...attemptIdentity, ...attemptOutcome, ...attemptPlayOptions, packRevision: packRevisionField,
  game: z.literal(nonogramsId), ruleset: z.literal(1), format: z.literal(1),
  board: marksSchema, undo: z.array(marksSchema).max(100),
})
export type NonogramSave = z.infer<typeof nonogramSaveSchema>

/**
 * Clear the player's marks while keeping the attempt intact. Outcome and
 * identity fields (elapsed time, completion, revisions, pack) are preserved. A
 * solved run is already not resettable.
 */
export function resetNonogramInput(save: NonogramSave): NonogramSave {
  if (save.completed) return save
  return { ...save, board: Array<Cell>(save.board.length).fill(0), undo: [] }
}

export const quickDescriptor = z.object({
  seed: z.uuid(), size: gridSizeSchema, difficulty: z.enum(randomDifficulties), version: z.literal(1),
})
export const nonogramMutation = mutationHeader.extend({ data: nonogramSaveSchema, ...challengeMutationField, quickPlay: quickDescriptor.optional() })
type QuickDescriptor = z.infer<typeof quickDescriptor>

const pictureSchema = z.array(z.string().regex(/^[.#]+$/).max(10)).max(10)
const entry = z.object({ ...packLevelFields, ruleset: z.literal(1), content: puzzleSchema, picture: pictureSchema.optional() })
  .refine(({ picture, content }) => !picture || (picture.length === content.rows.length &&
    picture.every(row => row.length === picture.length) && JSON.stringify(fromPicture(picture)) === JSON.stringify(content)))
export const nonogramPacks = definePackSchemas(nonogramsId, z.enum(['default', 'cockatoos']),
  progressionRules, entry, entry)
export type NonogramEntry = z.infer<typeof entry>
export type NonogramPack = PackRevision<z.infer<typeof nonogramPacks.published>>

export interface NonogramLevel extends GameLevel {
  content: Puzzle
  difficulty?: QuickDescriptor['difficulty']
}

export function nonogramLevels(pack: NonogramPack): NonogramLevel[] {
  const levels: NonogramLevel[] = []
  for (const chapter of pack.data.chapters) {
    for (const [index, entry] of chapter.puzzles.entries()) {
      levels.push({
        game: nonogramsId, id: entry.levelId ?? packLevelId(pack.id, chapter.id, index + 1),
        revision: entry.levelRevision ?? pack.revision,
        title: entry.title, ruleset: entry.ruleset, content: entry.content, source: pack.builtIn ? 'Built-in' : 'Creator',
        pack: { id: pack.id, revision: pack.revision, stop: levels.length + 1, chapter: chapter.id },
      })
    }
  }
  return levels
}

export function sameNonogramLevel(entry: NonogramEntry, previous: NonogramEntry) {
  return JSON.stringify(entry.content) === JSON.stringify(previous.content)
}

export function createNonogramAttempt(level: NonogramLevel, pack?: PackRevision, playOptions?: PlayOptions): NonogramSave {
  return {
    game: nonogramsId, level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    elapsedMs: 0, completed: false, packRevision: pack?.revision,
    board: Array(level.content.rows.length * level.content.columns.length).fill(0), undo: [],
    ...(playOptions ? { playOptions } : {}),
  }
}

export async function quickNonogram(descriptor: QuickDescriptor): Promise<NonogramLevel | undefined> {
  const { seed, size, difficulty, version } = descriptor
  const key = JSON.stringify([version, seed, size, difficulty])
  const bytes = await sha256(new TextEncoder().encode(key))
  let state = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const content = randomPuzzle({ size, difficulty }, random)
  if (!content) return undefined
  const id = 'nonograms-quick-' + [...bytes.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { game: nonogramsId, id, title: 'Random puzzle', ruleset: 1, revision: 1,
    source: 'Generated', seed, generatorVersion: version, content, difficulty }
}
