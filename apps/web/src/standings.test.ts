import assert from 'node:assert/strict'
import test from 'node:test'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { resultRows } from './standings.js'

const row = (rank: number): LeaderboardStanding => ({
  rank, name: 'P' + rank, value: rank * 1000, unit: 'ms', completedAt: '', recordedAt: '', you: false,
})

test('after-game rows keep the top three and the viewer neighbourhood', () => {
  const top = Array.from({ length: 20 }, (_, index) => row(index + 1))
  assert.deepEqual(resultRows(top, top[0], 20).map(item => item.rank), [1, 2, 3])
  assert.deepEqual(resultRows(top, row(10), 20).map(item => item.rank), [1, 2, 3, 9, 10, 11])
  assert.deepEqual(resultRows(top, row(20), 20).map(item => item.rank), [1, 2, 3, 18, 19, 20])
})
