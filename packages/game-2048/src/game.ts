import { z } from 'zod'
import {
  GameRuleError, gameContractVersion, type GameDefinition, type StoredLevel,
} from '../../game-sdk/src/game.js'
import type { PackDocument, PackRevision } from '../../game-sdk/src/packs.js'
import { upgradePackDocument } from '../../game-sdk/src/packs.js'
import {
  createTwenty48Attempt, quickDescriptor, quickPlayVersion, quickTwenty48, twenty48Id,
  twenty48Packs, twenty48RulesVersion, twenty48SaveSchema, validateTwenty48Attempt,
  type Twenty48Entry, type Twenty48Level, type Twenty48Save,
} from './contracts.js'
import { maxTile } from './rules.js'
import { twenty48 } from './metadata.js'
import {
  parseTwenty48Board, twenty48BoardKey, twenty48LeaderboardRulesVersion, twenty48PuzzleContent,
  twenty48QuickBoards, twenty48SeedCode,
} from './leaderboards.js'

const noRules = z.object({})

/** No authored levels in the MVP; the contract still requires pack schemas. */
function emptyPacks() {
  return {
    schemas: {
      manifest: twenty48Packs.manifest as unknown as z.ZodType<PackDocument>,
      draft: twenty48Packs.draft as unknown as z.ZodType<PackDocument>,
      published: twenty48Packs.published as unknown as z.ZodType<PackDocument>,
    },
    builtIn: [] as const,
    async verify(input: unknown, _prior: readonly StoredLevel[] = []) {
      const draft = twenty48Packs.draft.parse(upgradePackDocument(input)) as PackDocument
      if (!draft.chapters.some(chapter => chapter.puzzles.length)) throw new GameRuleError('pack_empty')
      return twenty48Packs.published.parse({ ...draft, chapters: draft.chapters.filter(chapter => chapter.puzzles.length) }) as PackDocument
    },
    materialize(pack: PackRevision) {
      const levels: Twenty48Level[] = []
      for (const chapter of pack.data.chapters) {
        for (const entry of chapter.puzzles as Twenty48Entry[]) {
          levels.push({
            game: twenty48Id,
            id: entry.levelId ?? ('pack:' + pack.id + ':' + levels.length + 1),
            revision: entry.levelRevision ?? pack.revision,
            ruleset: entry.ruleset,
            title: entry.title,
            source: pack.builtIn ? 'Built-in' : 'Creator',
            content: entry.content,
            pack: { id: pack.id, revision: pack.revision, stop: levels.length + 1, chapter: chapter.id },
          })
        }
      }
      return levels
    },
    sameContent(entry: Twenty48Entry, _rules: unknown, prior: Twenty48Entry) {
      return JSON.stringify(entry.content) === JSON.stringify(prior.content)
    },
  }
}

export const twenty48Game: GameDefinition<Twenty48Level, Twenty48Save, Record<string, never>, Record<string, never>> = {
  contractVersion: gameContractVersion,
  id: twenty48Id,
  meta: twenty48,
  preferences: z.object({ favorite2048: z.boolean() }),
  play: {
    save: {
      schema: twenty48SaveSchema,
      create: level => createTwenty48Attempt(level),
      validate: (attempt, level) => validateTwenty48Attempt(attempt, level),
    },
    rules: { schema: noRules, defaults: {} },
  },
  generation: {
    version: quickPlayVersion,
    quickPlay: quickDescriptor,
    describe(level) {
      if (level.source !== 'Generated' || !level.seed) return undefined
      const parsed = quickDescriptor.safeParse({ seed: level.seed, version: level.generatorVersion })
      return parsed.success ? { quickPlay: parsed.data } : undefined
    },
    options: {
      schema: z.object({}),
      defaults: {},
      fields: [],
    },
    async generate(seed) {
      const level = quickTwenty48(seed, quickPlayVersion)
      return {
        ruleset: twenty48RulesVersion,
        title: 'Classic',
        difficulty: 'Classic',
        content: level.content,
        generatorVersion: quickPlayVersion,
      }
    },
    async materialize(seed) {
      return quickTwenty48(seed, quickPlayVersion)
    },
    async verify(content) {
      const parsed = z.object({ start: z.array(z.number()).length(16), size: z.literal(4) }).safeParse(content.content)
      if (!parsed.success || parsed.data.start.filter(Boolean).length !== 2)
        throw new GameRuleError('twenty48_level_invalid')
    },
  },
  packs: emptyPacks(),
  leaderboard: {
    quickBoards: twenty48QuickBoards,
    board: twenty48BoardKey,
    parseBoard: parseTwenty48Board,
    result: (level, attempt) => {
      const save = twenty48SaveSchema.parse(attempt)
      return {
        value: save.score,
        unit: 'score',
        lowerIsBetter: false,
        aids: { moves: save.moves.length, reached2048: save.reached2048At !== undefined,
          maxTile: maxTile(save.board) },
        rulesVersion: twenty48LeaderboardRulesVersion,
        puzzleContent: twenty48PuzzleContent(level),
        seedCode: twenty48SeedCode(level),
      }
    },
  },
  // Keep 2048 out of Daily Challenges for now; the score board is independent.
  challenge: false,
}
