import type { GameRegistry } from '../../../../packages/game-sdk/src/game.js'
import { gameRegistry } from '../game-registry.js'
import { challengeGameFromDefinition } from './definition.js'
import type { ChallengeGameRuntime } from './types.js'

/**
 * Challenge-capable games are derived from the same GameRegistry as packs,
 * leaderboards and saves. Adding a game with `generation` and `leaderboard`
 * makes it eligible for daily challenges without editing challenge code.
 */
export function challengeGamesFromRegistry(registry: GameRegistry): readonly ChallengeGameRuntime[] {
  return registry.challengeCapable().flatMap(({ definition }) => {
    const game = challengeGameFromDefinition(definition)
    return game ? [game] : []
  })
}

export const challengeGames = challengeGamesFromRegistry(gameRegistry)
