import { z } from 'zod'
import { difficulties } from '../../game-sdk/src/index.js'

export const gridSchema = z.string().regex(/^[0-9]{81}$/)
export const difficultySchema = z.enum(difficulties)
export const quickPlayVersion = 2
const board = z.object({
  entries: z.array(z.number().int().min(0).max(9)).length(81),
  notes: z.array(z.number().int().min(0).max(511)).length(81),
})
export const saveSchema = z.object({
  game: z.literal('sudoku'),
  level: z.string().min(1).max(64),
  levelRevision: z.number().int().positive(),
  ruleset: z.literal(1),
  format: z.literal(1),
  board,
  undo: z.array(board).max(40),
  redo: z.array(board).max(40),
  elapsedMs: z.number().int().min(0).max(365 * 86400_000),
  completed: z.boolean(),
  completedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  lives: z.number().int().min(0).max(9).optional(),
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
  mutationId: z.uuid(), sessionId: z.uuid(), baseRevision: z.number().int().nonnegative(),
  data: saveSchema, archived: z.boolean(),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  archiveIfUnchanged: z.literal(true).optional(),
})
export type Mutation = z.infer<typeof mutationSchema>
export interface StoredSession {
  id: string; revision: number; data: SudokuSave; parentId?: string; archived: boolean; updatedAt?: number | null
}
export const generationSchema = z.object({ seed: z.string().trim().min(1).max(100), difficulty: difficultySchema, unique: z.boolean() })
