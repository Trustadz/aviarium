import type { ChallengeGameDefinition } from '../../../../packages/game-sdk/src/challenges.js'

/** A challenge-capable game plus its stable registry id. */
export interface ChallengeGameRuntime extends ChallengeGameDefinition {
  id: string
}
