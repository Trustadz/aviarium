import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()

// Platform modules must not branch on a game id. Registration, the game
// modules, the marketing hero and the quarantined legacy Sudoku Studio are the
// explicit allowlist; this list is intentionally shrinking.
const platformFiles = [
  'apps/server/src/app.ts',
  'apps/server/src/auth.ts',
  'apps/server/src/game-registry.ts',
  'apps/server/src/game-routes.ts',
  'apps/server/src/generated-level.ts',
  'apps/server/src/leaderboards.ts',
  'apps/server/src/migrate.ts',
  'apps/server/src/packs.ts',
  'apps/server/src/progress.ts',
  'apps/server/src/server-game-adapter.ts',
  'apps/server/src/challenges/definition.ts',
  'apps/server/src/challenges/registry.ts',
  'apps/server/src/challenges/routes.ts',
  'apps/server/src/challenges/store.ts',
  'apps/web/src/main.tsx',
  'apps/web/src/GamePacks.tsx',
  'apps/web/src/Leaderboards.tsx',
  'apps/web/src/LeaderboardChallenges.tsx',
  'apps/web/src/ResultStandingsPanel.tsx',
  'apps/web/src/Challenges.tsx',
  'apps/web/src/ChallengeSettings.tsx',
  'apps/web/src/GameHistory.tsx',
  'apps/web/src/game-definitions.ts',
  'apps/web/src/game-web.ts',
  'apps/web/src/game-studio.ts',
]

test('platform modules do not branch on a game id or name', () => {
  for (const file of platformFiles) {
    const source = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(source, /['"](?:sudoku|nonograms)['"]/,
      `${file} contains a game-id string literal; keep it in registration, a game module or the legacy quarantine.`)
  }
})
