import {
  validateGameRegistry, type GameDefinition, type GameRegistry, type RegisteredGame,
} from '../../../packages/game-sdk/src/game.js'
import { nonogramsGame } from '../../../packages/nonograms/src/game.js'
import { sudokuGame } from '../../../packages/sudoku/src/game.js'

/**
 * Build the platform's game registry from definitions. The platform modules
 * should depend on this interface, not on a hard-coded list of game ids. A new
 * game is added by passing its definition here (and registering its browser
 * Player/Studio in the web registry); no pack, leaderboard, save or challenge
 * code needs a game-specific branch.
 */
export function createGameRegistry(definitions: readonly GameDefinition<any, any, any, any>[]): GameRegistry {
  const games: RegisteredGame[] = definitions.map(definition => ({ definition }))
  validateGameRegistry(games)
  const byId = new Map(games.map(game => [game.definition.id, game]))
  return {
    all: () => games,
    get: id => byId.get(id),
    challengeCapable: () => games.filter(game => Boolean(game.definition.generation && game.definition.leaderboard)),
  }
}

/** The installed game definitions. Adding a game starts here. */
export const builtInGameDefinitions = [sudokuGame, nonogramsGame] as const
export const gameRegistry = createGameRegistry(builtInGameDefinitions)
