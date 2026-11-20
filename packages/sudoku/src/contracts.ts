import { z } from 'zod'

export const gridSchema = z.string().regex(/^[0-9]{81}$/)
export const difficultySchema = z.enum(['Easy', 'Medium', 'Hard'])
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
})
export type SudokuSave = z.infer<typeof saveSchema>
export const preferenceSchema = z.object({
  favorite: z.boolean(), mistakes: z.boolean(), timer: z.boolean(), hints: z.boolean(), reader: z.boolean(),
})
export type Preferences = z.infer<typeof preferenceSchema>
export const defaults: Preferences = { favorite: false, mistakes: true, timer: true, hints: true, reader: false }

export const mutationSchema = z.object({
  mutationId: z.uuid(), sessionId: z.uuid(), baseRevision: z.number().int().nonnegative(),
  data: saveSchema, archived: z.boolean(),
})
export type Mutation = z.infer<typeof mutationSchema>
export interface StoredSession { id: string; revision: number; data: SudokuSave; parentId?: string; archived: boolean }
export const generationSchema = z.object({ seed: z.string().trim().min(1).max(100), difficulty: difficultySchema, unique: z.boolean() })
