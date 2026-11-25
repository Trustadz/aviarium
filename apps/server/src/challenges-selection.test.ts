import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChallengeGameSelection } from '../../../packages/game-sdk/src/challenges.js'
import { challengeGames } from './challenges/registry.js'
import { selectSlate, type OccurrenceRow, type SeriesRow } from './challenges/store.js'

const gameSelections: ChallengeGameSelection[] = [
  { game: 'sudoku', options: { difficulty: ['Medium'] } },
  { game: 'nonograms', options: { size: ['5'], difficulty: ['Easy', 'Medium', 'Hard'] } },
  { game: 'nonograms', options: { size: ['10'], difficulty: ['Easy', 'Medium'] } },
]

const series: SeriesRow = {
  id: 'daily', kind: 'daily', enabled: true, game_limit: 2, eligible_games: null,
  game_options: {}, game_selections: gameSelections, timezone: 'UTC', reset_minute: 0,
  generation_version: 1, label: null, metadata: {}, updated_at: new Date(),
}

const occurrence: OccurrenceRow = {
  id: '00000000-0000-4000-8000-000000000000', series_id: 'daily', period_key: '2026-11-24',
  starts_at: '2026-11-24T00:00:00.000Z', ends_at: '2026-11-25T00:00:00.000Z',
  timezone: 'UTC', reset_minute: 0, generation_version: 1,
  settings: { gameLimit: 2, gameSelections }, seed: 'selection-test-seed',
  preparing_at: null, prepared_at: null, failure_code: null,
}

test('game selections choose distinct games and one profile per game', () => {
  const slate = selectSlate(series, occurrence, challengeGames)
  assert.equal(slate.length, 2)
  assert.equal(new Set(slate.map(item => item.game.id)).size, 2)
  const nonogram = slate.find(item => item.game.id === 'nonograms')
  assert.ok(nonogram)
  const size = Number(nonogram.options.size)
  assert.ok(size === 5 || size === 10)
  if (size === 10) assert.notEqual(nonogram.options.difficulty, 'Hard')
  assert.deepEqual(nonogram.groups.size, String(size))
  assert.deepEqual(selectSlate(series, occurrence, challengeGames).map(item => ({
    game: item.game.id, groups: item.groups,
  })), slate.map(item => ({ game: item.game.id, groups: item.groups })))
})

test('a duplicated game still occupies only one daily slot', () => {
  const onlyNonograms: ChallengeGameSelection[] = [
    { game: 'nonograms', options: { size: ['5'], difficulty: ['Easy'] } },
    { game: 'nonograms', options: { size: ['10'], difficulty: ['Medium'] } },
  ]
  const slate = selectSlate({ ...series, game_selections: onlyNonograms },
    { ...occurrence, settings: { gameLimit: 2, gameSelections: onlyNonograms } }, challengeGames)
  assert.equal(slate.length, 1)
  assert.equal(slate[0]!.game.id, 'nonograms')
})
