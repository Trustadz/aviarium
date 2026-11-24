/**
 * The game contract.
 *
 * A game owns gameplay and level creation. The platform owns routing, packs,
 * leaderboards, saves/resume, offline assets and daily-challenge scheduling.
 * The shared definition is imported by both the browser and the server; it must
 * stay free of React, Fastify and pg imports.
 *
 * The important ownership split is:
 * - the game returns a GameResult (how the attempt was scored);
 * - the platform assigns the board (general level/quick board or challenge slot).
 * That makes a challenge result leaking onto a general board structurally
 * impossible instead of a review rule.
 */
import type { z } from 'zod'
import type { GameLevel, GameMetadata } from './index.js'
import type { GameAttempt } from './progress.js'
import type { LeaderboardBoardKey } from './leaderboards.js'
import type { PackDocument, PackEntry, PackRevision } from './packs.js'

export const gameContractVersion = 1

/** JSON-safe effective gameplay rules for one level. */
export type GameRuleValues = Readonly<Record<string, unknown>>

/** The game-owned payload of one generated or authored level. */
export interface GeneratedContent {
  ruleset: number
  title: string
  difficulty?: string | null
  /** Legacy Sudoku storage only. New games use `content`. */
  grid?: string | null
  /** Opaque game-owned JSON, persisted in published_levels.content. */
  content?: unknown
  generatorVersion: number
}

/** One selectable value rendered by the platform's Quick Play/admin forms. */
export interface GameOptionField {
  key: string
  /** Message key; the platform translates it. */
  label: string
  choices: readonly { value: string | number; label: string }[]
}

/** Reserved extension point for future challenge option variants. */
export interface GameOptionGroup {
  key: string
  label: string
  kind: 'generation' | 'rule'
  choices: readonly { id: string; label: string; value: string | number | boolean | null }[]
  defaultEnabled: readonly string[]
}

export interface GameGeneration<Options, Level extends GameLevel> {
  version: number
  options: {
    /** User-selectable values only. The seed is passed separately. */
    schema: z.ZodType<Options>
    defaults: Options
    fields: readonly GameOptionField[]
  }
  /** Pure and deterministic: same (seed, options) => same content. */
  generate(seed: string, options: Options): Promise<GeneratedContent | undefined>
  /**
   * Optional for legacy id compatibility. Without it the platform builds a
   * default generated level from the content and a stable id.
   */
  materialize?(seed: string, options: Options, content: GeneratedContent): Level
  /** Optional pre-persist check (unique solution, grade, solvability). */
  verify?(content: GeneratedContent, options: Options): Promise<void>
}

export interface SaveContext<Rules extends GameRuleValues> {
  /** Present for an authored pack level; absent for Quick Play / challenge levels. */
  pack?: PackRevision
  rules: Rules
}

export interface GamePlay<Level extends GameLevel, Attempt extends GameAttempt, Rules extends GameRuleValues> {
  save: {
    schema: z.ZodType<Attempt>
    create(level: Level, context: SaveContext<Rules>): Attempt
    /** Throws GameRuleError; the platform maps it to the API envelope. */
    validate(attempt: Attempt, level: Level, context: SaveContext<Rules>): void
  }
  rules: {
    schema: z.ZodType<Rules>
    defaults: Rules
  }
}

export interface GamePacks<Level extends GameLevel, Rules extends GameRuleValues> {
  schemas: {
    manifest: z.ZodType<PackDocument>
    draft: z.ZodType<PackDocument>
    published: z.ZodType<PackDocument>
  }
  builtIn: readonly { id: string; revision: number; coverFile?: string; data: PackDocument }[]
  verify(pack: PackDocument, prior: readonly StoredLevel[]): Promise<PackDocument>
  /** Pack document -> exact level rows. The platform owns ordering/revisions. */
  materialize(pack: PackRevision): Level[]
  /** Optional override; default compares gameplay content + ruleset. */
  sameContent?(entry: PackEntry, rules: Rules, prior: PackEntry, priorRules: Rules): boolean
}

/** One completed, already-validated attempt. Board identity is not here. */
export interface GameResult {
  value: number
  unit: 'ms'
  lowerIsBetter: boolean
  aids?: unknown
  rulesVersion: number
  /** Exact starting puzzle for the cooldown. Default: hash of the level content. */
  puzzleContent: string
  seedCode?: string
}

export interface GameLeaderboard<Level extends GameLevel, Attempt extends GameAttempt, Rules extends GameRuleValues> {
  /** Optional Quick Play boards. Omit for level-only games. */
  quickBoards?: readonly LeaderboardBoardKey[]
  /** Optional; default is one level board per exact revision. */
  board?(level: Level): LeaderboardBoardKey
  /** Required only if old board-key strings must remain parseable. */
  parseBoard?(key: string): LeaderboardBoardKey | undefined
  result(level: Level, attempt: Attempt, rules: Rules): GameResult
}

export interface GameDefinition<
  Level extends GameLevel = GameLevel,
  Attempt extends GameAttempt = GameAttempt,
  Rules extends GameRuleValues = GameRuleValues,
  Options = Record<string, never>,
> {
  contractVersion: typeof gameContractVersion
  id: string
  meta: GameMetadata
  play: GamePlay<Level, Attempt, Rules>
  /** Optional: a game with no generator can still ship packs and saves. */
  generation?: GameGeneration<Options, Level>
  packs: GamePacks<Level, Rules>
  /** Optional: default elapsedMs, lower-is-better, level boards. */
  leaderboard?: GameLeaderboard<Level, Attempt, Rules>
  preferences?: z.ZodObject
  /** Optional overrides. Usually omitted. */
  challenge?: {
    /** Daily default generation options; defaults to generation.options.defaults. */
    options?: Options
    /** Daily default rules; defaults to play.rules.defaults. */
    rules?: Rules
    /** Reserved extension point; not used by the first build. */
    optionGroups?: readonly GameOptionGroup[]
  }
}

/** A stored level row, shared by packs, Quick Play and challenges. */
export interface StoredLevel extends GameLevel {
  grid?: string | null
  difficulty?: string | null
  content?: unknown
}

/** A typed rule failure from a game package; the server maps it to HttpError. */
export class GameRuleError extends Error {
  constructor(public code: string, public values?: Record<string, unknown>) {
    super(code)
    this.name = 'GameRuleError'
  }
}

export interface RegisteredGame {
  definition: GameDefinition
}

export interface GameRegistry {
  all(): readonly RegisteredGame[]
  get(id: string): RegisteredGame | undefined
  /** Games with a generator and save validation; used by Quick Play and challenges. */
  challengeCapable(): readonly RegisteredGame[]
}

/**
 * Validate a registry at startup. A malformed definition fails fast instead of
 * surfacing as a first-request error. The platform owns ids, sources and boards;
 * this check catches a game that tries to take them over.
 */
export function validateGameRegistry(games: readonly RegisteredGame[]): void {
  const ids = new Set<string>()
  for (const registered of games) {
    const { definition } = registered
    if (definition.contractVersion !== gameContractVersion)
      throw new Error('game_contract_invalid: ' + definition.id + ' has an unsupported contract version')
    if (!definition.id || definition.id !== definition.meta.id)
      throw new Error('game_contract_invalid: game id does not match metadata for ' + definition.id)
    if (ids.has(definition.id))
      throw new Error('game_contract_invalid: duplicate game id ' + definition.id)
    ids.add(definition.id)
    if (!definition.play?.save?.schema || !definition.play.save.create || !definition.play.save.validate)
      throw new Error('game_contract_invalid: ' + definition.id + ' has no save contract')
    if (!definition.packs?.schemas)
      throw new Error('game_contract_invalid: ' + definition.id + ' has no pack schemas')
    for (const builtIn of definition.packs.builtIn) {
      if (!builtIn.id || !Number.isInteger(builtIn.revision) || builtIn.revision < 1)
        throw new Error('game_contract_invalid: ' + definition.id + ' has an invalid built-in pack')
      if (builtIn.data.game !== definition.id)
        throw new Error('game_contract_invalid: built-in pack game mismatch for ' + definition.id)
    }
  }
}
