import { z } from 'zod'
import { difficulties, type Difficulty, type GameLevel } from '../../game-sdk/src/index.js'
import { attemptIdentity, attemptOutcome, attemptPlayOptions, challengeMutationField, mutationIdentity, mutationStatus, packRevisionField, type SavedAttempt } from '../../game-sdk/src/progress.js'
import { rulesFor } from './rules.js'

export interface PublishedLevel extends GameLevel {
  grid: string
  difficulty: Difficulty
}

export const gridSchema = z.string().regex(/^[0-9]{81}$/)
export const difficultySchema = z.enum(difficulties)
export const quickPlayVersion = 2
/** A new hint can be requested again after this many milliseconds. */
export const hintCooldownMs = 10_000
export const quickPlayDescriptorSchema = z.object({
  seed: z.string().trim().min(1).max(100), difficulty: difficultySchema, version: z.literal(quickPlayVersion),
})
export type QuickPlayDescriptor = z.infer<typeof quickPlayDescriptorSchema>
const board = z.object({
  entries: z.array(z.number().int().min(0).max(9)).length(81),
  notes: z.array(z.number().int().min(0).max(511)).length(81),
})
export const saveSchema = z.object({
  game: z.literal('sudoku'), ...attemptIdentity,
  ruleset: z.union([z.literal(1), z.literal(2)]),
  format: z.literal(1),
  board,
  undo: z.array(board).max(40),
  redo: z.array(board).max(40),
  ...attemptOutcome, ...attemptPlayOptions,
  lives: z.number().int().min(0).max(9).optional(),
  aids: z.object({ hints: z.boolean(), autoNotes: z.boolean(), mistakes: z.boolean() }).optional(),
  /**
   * How many distinct hints this attempt has requested. The counter is
   * informational only: it is reported to the leaderboard but never changes
   * rank. Older saves and clients omit it, so it stays optional.
   */
  hintsUsed: z.number().int().min(0).max(100_000).optional(),
  /** Wall-clock time when the next new hint becomes available. */
  hintCooldownUntil: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  packRevision: packRevisionField,
})
export type SudokuSave = z.infer<typeof saveSchema>

/** Remaining cooldown before another new hint can be requested. */
export function hintCooldownRemaining(save: Pick<SudokuSave, 'hintCooldownUntil'>, now = Date.now()) {
  return Math.max(0, (save.hintCooldownUntil ?? 0) - now)
}

/**
 * Clear the player's board input while keeping the attempt intact: the givens
 * return, notes and undo/redo history clear, and every outcome/identity field
 * (elapsed time, lives, aids, completion, revisions, pack) is preserved. A
 * finished run (solved or out of lives) is already not resettable.
 */
export function resetSudokuInput(save: SudokuSave, givens: readonly number[]): SudokuSave {
  if (save.completed || save.lives === 0) return save
  return { ...save, board: rulesFor(save.ruleset === 2).create(givens), undo: [], redo: [] }
}

export const preferenceSchema = z.object({
  favorite: z.boolean(), mistakes: z.boolean(), timer: z.boolean(), hints: z.boolean(),
  autoNotes: z.boolean(), autoNoteDeletion: z.boolean(),
})
export type Preferences = z.infer<typeof preferenceSchema>
export const defaults: Preferences = {
  favorite: false, mistakes: true, timer: true, hints: true, autoNotes: true, autoNoteDeletion: true,
}

export const mutationSchema = z.object({
  ...mutationIdentity, data: saveSchema, ...mutationStatus, ...challengeMutationField,
  quickPlay: quickPlayDescriptorSchema.optional(),
})
export type Mutation = z.infer<typeof mutationSchema>
export type StoredSession = SavedAttempt<SudokuSave>
export const generationSchema = z.object({ seed: z.string().trim().min(1).max(100), difficulty: difficultySchema, unique: z.boolean() })
