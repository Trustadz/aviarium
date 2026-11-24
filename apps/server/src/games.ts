import { gameRegistry } from './game-registry.js'
import { nonogramsServer } from './nonograms-game.js'
import { serverGameFromDefinition } from './server-game-adapter.js'
import { sudokuServer } from './sudoku-game.js'

/**
 * Transitional compatibility map: the game definitions are the source of
 * truth, while the legacy route providers remain quarantined here until J4.
 */
const legacyRoutes = new Map([
  ['sudoku', sudokuServer.routes],
  ['nonograms', nonogramsServer.routes],
])

export function createServerGames() {
  return new Map(gameRegistry.all().map(({ definition }) => [
    definition.id, serverGameFromDefinition(definition, legacyRoutes.get(definition.id)),
  ]))
}
