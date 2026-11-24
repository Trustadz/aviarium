import type { GameRegistry } from '../../../packages/game-sdk/src/game.js'
import { gameRegistry } from './game-registry.js'
import { registerLegacySudokuRoutes } from './legacy-sudoku-routes.js'
import { serverGameFromDefinition } from './server-game-adapter.js'

/**
 * Transitional compatibility map: the game definitions are the source of
 * truth, while the legacy route providers remain quarantined here until J4.
 */
const legacyRoutes = new Map([
  ['sudoku', registerLegacySudokuRoutes],
])

export function createServerGames(registry: GameRegistry = gameRegistry) {
  return new Map(registry.all().map(({ definition }) => [
    definition.id, serverGameFromDefinition(definition, legacyRoutes.get(definition.id)),
  ]))
}
