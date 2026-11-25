import type { PublishedLevel } from './contracts.js'
import { z } from 'zod'
import { difficultySchema, gridSchema } from './contracts.js'

import { definePackSchemas, packLevelFields, packLevelId, progressionRules, effectiveChapterRules,
  type PackDraftRecord, type PackRevision } from '../../game-sdk/src/packs.js'
export { authoringPack, effectivePackRules, packImageBytes, packLevelId, packProgress, packProgressPath, packUploadBytes,
  type PackCompletion, type PackPath } from '../../game-sdk/src/packs.js'

const packRulesSchema = progressionRules.extend({
  hints: z.boolean(), autoNotes: z.boolean(), lives: z.number().int().min(1).max(9).nullable(),
  timeTrial: z.boolean(), diagonal: z.boolean().optional(),
})
const puzzle = z.object({
  ...packLevelFields, grid: gridSchema, ruleset: z.union([z.literal(1), z.literal(2)]),
  rules: packRulesSchema.partial().optional(),
  seed: z.string().trim().min(1).max(100).optional(),
  generatorVersion: z.number().int().positive().optional(),
})
const schemas = definePackSchemas('sudoku', z.enum(['default', 'meadow', 'twilight', 'sunrise']), packRulesSchema,
  puzzle, puzzle.extend({ difficulty: difficultySchema }))
export const { manifest: packManifestSchema, draft: packDraftSchema, published: gradedPackSchema } = schemas
export type PackDraftData = z.infer<typeof packDraftSchema>
export type GradedPack = z.infer<typeof gradedPackSchema>
export type PackRules = PackDraftData['chapters'][number]['rules']
export type PackDraft = PackDraftRecord<PackDraftData>
export type PublishedPack = PackRevision<GradedPack>

export function packLevels(pack: PublishedPack): PublishedLevel[] {
  const levels: PublishedLevel[] = []
  for (const chapter of pack.data.chapters) {
    for (const [index, entry] of chapter.puzzles.entries()) {
      const { levelId, levelRevision, title, grid, difficulty, seed, generatorVersion } = entry
      const ruleset = packRuleset(effectiveChapterRules(chapter, index + 1))
      levels.push({
        title, grid, ruleset, difficulty,
        seed: ruleset === 2 ? undefined : seed, generatorVersion: ruleset === 2 ? undefined : generatorVersion,
        id: levelId ?? packLevelId(pack.id, chapter.id, index + 1), revision: levelRevision ?? pack.revision,
        source: pack.builtIn ? 'Built-in' : 'Creator',
        pack: { id: pack.id, revision: pack.revision, stop: levels.length + 1, chapter: chapter.id },
      })
    }
  }
  return levels
}
export const packRuleset = (rules: Pick<PackRules, 'diagonal'>) => rules.diagonal ? 2 : 1

export function sameSudokuLevel(entry: PackDraftData['chapters'][number]['puzzles'][number], rules: PackRules,
  old: PackDraftData['chapters'][number]['puzzles'][number], oldRules: PackRules) {
  return entry.grid === old.grid && packRuleset(rules) === packRuleset(oldRules) &&
    rules.hints === oldRules.hints && rules.autoNotes === oldRules.autoNotes &&
    rules.lives === oldRules.lives && rules.timeTrial === oldRules.timeTrial
}

export function packRuleLabels(rules: PackRules) {
  return [
    rules.inOrder ? 'In order' : 'Pick & choose',
    !rules.hints && 'No hints', !rules.autoNotes && 'No Auto notes',
    rules.lives && `${rules.lives} ${rules.lives === 1 ? 'life' : 'lives'}`,
    rules.timeTrial && 'Always show timer',
    rules.diagonal && 'Diagonal Sudoku',
  ].filter(Boolean)
}
