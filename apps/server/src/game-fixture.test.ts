import assert from 'node:assert/strict'
import test from 'node:test'
import { fixtureGame } from '../../../packages/game-fixture/src/index.js'
import { sudokuGame } from '../../../packages/sudoku/src/game.js'
import { challengeGamesFromRegistry } from './challenges/registry.js'
import { createGameRegistry } from './game-registry.js'
import { createServerGames } from './games.js'

const save = {
  game: 'fixture' as const, level: 'fixture-x', levelRevision: 1, ruleset: 1, format: 1,
  elapsedMs: 1234, completed: true,
}

test('a package-backed third definition reaches the platform map and challenge derivation', async () => {
  const registry = createGameRegistry([sudokuGame, fixtureGame])
  const game = createServerGames(registry).get('fixture')
  assert.ok(game)
  const mutation = game.readMutation({
    mutationId: crypto.randomUUID(), sessionId: crypto.randomUUID(), baseRevision: 0,
    updatedAt: 1, archived: false, data: save,
  })
  assert.equal(mutation.data.game, 'fixture')
  const level = { id: 'fixture-x', revision: 1, ruleset: 1, title: 'Fixture', source: 'Generated' as const }
  const result = game.leaderboards!.record(level, save)
  assert.equal(result.value, 1234)
  assert.equal(result.boardKind, 'level')

  const challenge = challengeGamesFromRegistry(registry).find(item => item.id === 'fixture')
  assert.ok(challenge)
  const generated = await challenge.generate({
    seriesId: 'daily', occurrenceId: '00000000-0000-4000-8000-000000000000', periodKey: '2026-11-24',
    game: 'fixture', seed: 'fixture-seed',
    selection: { groups: { difficulty: 'normal' }, options: { difficulty: 'normal' }, rules: {} },
  })
  assert.equal(generated.ruleset, 1)
  const challengeResult = challenge.record({ ...generated, id: 'fixture-x', revision: 1, source: 'Challenge' }, save, {})
  assert.equal(challengeResult.value, 1234)
})
