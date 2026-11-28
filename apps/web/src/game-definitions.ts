import type { GameDefinition } from '../../../packages/game-sdk/src/game.js'
import type { GameAttempt, PlayOptions } from '../../../packages/game-sdk/src/progress.js'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { nonogramsGame } from '../../../packages/nonograms/src/game.js'
import { twenty48Game } from '../../../packages/game-2048/src/game.js'
import { sudokuGame } from '../../../packages/sudoku/src/game.js'

/**
 * The browser's view of the shared game definitions. Board identity and save
 * creation live here, not in the per-game WebGame registration.
 */
export const webGameDefinitions = new Map<string, GameDefinition<any, any, any, any>>([
  [sudokuGame.id, sudokuGame],
  [nonogramsGame.id, nonogramsGame],
  [twenty48Game.id, twenty48Game],
])

export function gameDefinition(gameId: string) {
  return webGameDefinitions.get(gameId)
}

export function hasLeaderboard(gameId: string) {
  return Boolean(gameDefinition(gameId)?.leaderboard)
}

export function gameBoardHref(gameId: string, level: GameLevel): string | undefined {
  const definition = gameDefinition(gameId)
  if (!definition?.leaderboard) return undefined
  const board = definition.leaderboard.board?.(level as never) ?? {
    key: 'level:' + level.id + ':' + level.revision, kind: 'level' as const, meta: {},
    levelId: level.id, levelRevision: level.revision,
  }
  return '/games/' + gameId + '/leaderboards/board/' + encodeURIComponent(board.key)
}

export function createGameAttempt(gameId: string, level: GameLevel, pack?: PackRevision,
  playOptions?: PlayOptions): GameAttempt {
  const definition = gameDefinition(gameId)
  if (!definition) throw new Error('This game is not available in this version.')
  return definition.play.save.create(level as never, {
    pack: pack as never,
    rules: definition.play.rules.defaults as never,
    playOptions,
  }) as GameAttempt
}

export function packLevels(gameId: string, pack: PackRevision): GameLevel[] {
  const definition = gameDefinition(gameId)
  if (!definition) return []
  return definition.packs.materialize(pack as never) as GameLevel[]
}
