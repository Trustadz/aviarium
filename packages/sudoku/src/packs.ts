import { z } from 'zod'
import type { PublishedLevel } from '../../game-sdk/src/index.js'
import { difficultySchema, gridSchema } from './contracts.js'

export const packImageBytes = 512 * 1024
export const packUploadBytes = 1200 * 1024
const image = z.string().max(Math.ceil(packImageBytes / 3) * 4 + 32)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
const header = {
  format: z.literal(1),
  game: z.literal('sudoku'),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(420),
  theme: z.enum(['meadow', 'twilight', 'sunrise']),
  rules: z.object({
    hints: z.boolean(), autoNotes: z.boolean(), inOrder: z.boolean(),
    lives: z.number().int().min(1).max(9).nullable(), timeTrial: z.boolean(),
  }),
}
const puzzle = z.object({
  title: z.string().trim().min(1).max(100), grid: gridSchema, ruleset: z.literal(1),
  seed: z.string().trim().min(1).max(100).optional(),
  generatorVersion: z.number().int().positive().optional(),
})
export const packManifestSchema = z.object({
  ...header, puzzles: z.array(puzzle).max(30),
})
export const packDraftSchema = packManifestSchema.extend({ cover: image.optional(), background: image.optional() })
export const gradedPackSchema = packDraftSchema.extend({
  puzzles: z.array(puzzle.extend({ difficulty: difficultySchema })).min(1).max(30),
})
export type PackDraftData = z.infer<typeof packDraftSchema>
export type GradedPack = z.infer<typeof gradedPackSchema>
export type PackRules = PackDraftData['rules']
export interface PackDraft { id: string; version: number; published: number | null; visible: boolean; data: PackDraftData }
export interface PublishedPack {
  id: string; revision: number; builtIn: boolean; data: GradedPack
  ownedByViewer?: boolean
}

export function packLevels(pack: PublishedPack): PublishedLevel[] {
  return pack.data.puzzles.map((puzzle, index) => ({
    ...puzzle, id: packLevelId(pack.id, index + 1), revision: pack.revision,
    source: pack.builtIn ? 'Built-in' : 'Creator',
    pack: { id: pack.id, revision: pack.revision, stop: index + 1 },
  }))
}
export const packLevelId = (id: string, stop: number) => 'pack:' + id + ':' + stop

export function packRuleLabels(rules: PackRules) {
  return [
    rules.inOrder ? 'In order' : 'Pick & choose',
    !rules.hints && 'No hints', !rules.autoNotes && 'No Auto notes',
    rules.lives && `${rules.lives} ${rules.lives === 1 ? 'life' : 'lives'}`,
    rules.timeTrial && 'Time trial',
  ].filter(Boolean)
}
