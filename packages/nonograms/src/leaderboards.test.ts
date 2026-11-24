import assert from 'node:assert/strict'
import test from 'node:test'
import { nonogramBoardKey, nonogramPuzzleContent, parseNonogramBoard } from './leaderboards.js'

const puzzle = { rows: [[1], [1], [1], [1], [1]], columns: [[1], [1], [1], [1], [1]] }

test('groups random Nonograms by size and difficulty', () => {
  assert.deepEqual(nonogramBoardKey({ id: 'nonograms-quick-abc', revision: 1, source: 'Generated',
    difficulty: 'Medium', content: puzzle }), { key: 'quick:5:Medium', kind: 'quick', meta: { size: 5, difficulty: 'Medium' } })
  assert.deepEqual(nonogramBoardKey({ id: 'nonograms-egg', revision: 2, source: 'Built-in', content: puzzle }),
    { key: 'level:nonograms-egg:2', kind: 'level', meta: {}, levelId: 'nonograms-egg', levelRevision: 2 })
})

test('only supports random sizes the game generates', () => {
  assert.deepEqual(parseNonogramBoard('quick:10:Hard'), { key: 'quick:10:Hard', kind: 'quick', meta: { size: 10, difficulty: 'Hard' } })
  assert.equal(parseNonogramBoard('quick:7:Hard'), undefined)
  assert.equal(parseNonogramBoard('quick:10:Extreme'), undefined)
  assert.equal(parseNonogramBoard('level:nonograms-egg:0'), undefined)
})

test('canonical clue content distinguishes different puzzles', () => {
  const other = { rows: [[2], [1]], columns: [[1], [1]] }
  assert.notEqual(nonogramPuzzleContent(puzzle), nonogramPuzzleContent(other))
  assert.equal(nonogramPuzzleContent(puzzle), '1;1;1;1;1|1;1;1;1;1')
})
