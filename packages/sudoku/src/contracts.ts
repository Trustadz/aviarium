import { z } from 'zod'
import { difficulties, type Difficulty, type GameLevel } from '../../game-sdk/src/index.js'
import { attemptIdentity, attemptOutcome, mutationIdentity, mutationStatus, packRevisionField, type SavedAttempt } from '../../game-sdk/src/progress.js'

export interface PublishedLevel extends GameLevel {
  grid: string
  difficulty: Difficulty
}

export const gridSchema = z.string().regex(/^[0-9]{81}$/)
export const difficultySchema = z.enum(difficulties)
export const quickPlayVersion = 2
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
  ...attemptOutcome,
  lives: z.number().int().min(0).max(9).optional(),
  packRevision: packRevisionField,
})
export type SudokuSave = z.infer<typeof saveSchema>
export const preferenceSchema = z.object({
  favorite: z.boolean(), mistakes: z.boolean(), timer: z.boolean(), hints: z.boolean(),
  autoNotes: z.boolean(), autoNoteDeletion: z.boolean(),
})
export type Preferences = z.infer<typeof preferenceSchema>
export const defaults: Preferences = {
  favorite: false, mistakes: true, timer: true, hints: true, autoNotes: true, autoNoteDeletion: true,
}

export const mutationSchema = z.object({
  ...mutationIdentity, data: saveSchema, ...mutationStatus,
  quickPlay: quickPlayDescriptorSchema.optional(),
})
export type Mutation = z.infer<typeof mutationSchema>
export type StoredSession = SavedAttempt<SudokuSave>
export const generationSchema = z.object({ seed: z.string().trim().min(1).max(100), difficulty: difficultySchema, unique: z.boolean() })
