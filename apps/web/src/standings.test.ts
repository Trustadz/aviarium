import assert from 'node:assert/strict'
import test from 'node:test'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { resultGroups, resultRows } from './standings.js'

const row = (rank: number): LeaderboardStanding => ({
  rank, name: 'P' + rank, value: rank * 1000, unit: 'ms', completedAt: '', recordedAt: '', you: false,
})

test('after-game rows keep the top three and the viewer neighbourhood', () => {
  const top = Array.from({ length: 20 }, (_, index) => row(index + 1))
  assert.deepEqual(resultRows(top, top[0], 20).map(item => item.rank), [1, 2, 3])
  const mid = resultRows(top, { ...row(10), you: true }, 20)
  assert.deepEqual(mid.map(item => item.rank), [1, 2, 3, 9, 10, 11])
  assert.equal(mid.find(item => item.rank === 10)?.you, true)
  assert.deepEqual(resultRows(top, row(20), 20).map(item => item.rank), [1, 2, 3, 18, 19, 20])
})

test('after-game groups keep the top three apart from the viewer window', () => {
  const top = Array.from({ length: 20 }, (_, index) => row(index + 1))
  assert.deepEqual(resultGroups(top, { ...row(7), you: true }, 20).map(group => group.map(item => item.rank)),
    [[1, 2, 3], [6, 7, 8]])
  assert.deepEqual(resultGroups(top, top[0], 20).map(group => group.map(item => item.rank)), [[1, 2, 3]])
})
