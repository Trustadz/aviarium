import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyLeaderboardSummary, formatLeaderboardValue, leaderboardCooldownDays, withinLeaderboardCooldown,
} from './leaderboards.js'

test('formats duration results as minutes and seconds', () => {
  assert.equal(formatLeaderboardValue(245_000, 'ms'), '4:05')
  assert.equal(formatLeaderboardValue(0, 'ms'), '0:00')
  assert.equal(formatLeaderboardValue(3_600_000, 'ms'), '60:00')
})

test('keeps the cooldown scoped to the configured window', () => {
  const now = Date.UTC(2026, 10, 23, 12)
  assert.equal(leaderboardCooldownDays, 30)
  assert.equal(withinLeaderboardCooldown(now - 29 * 86_400_000, now), true)
  assert.equal(withinLeaderboardCooldown(new Date(now - 31 * 86_400_000), now), false)
  assert.equal(withinLeaderboardCooldown(now, now), true)
})

test('an empty summary still carries its board', () => {
  const board = { game: 'sudoku', key: 'quick:Easy', kind: 'quick' as const, difficulty: 'Easy' }
  assert.deepEqual(emptyLeaderboardSummary(board), { board, top: [], you: null, total: 0 })
})
