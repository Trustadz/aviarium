import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSudokuBoard, sudokuBoardKey, sudokuPuzzleContent, sudokuSeedCode } from './leaderboards.js'

test('groups Quick Play by difficulty and fixed levels by revision', () => {
  assert.deepEqual(sudokuBoardKey({ id: 'quick-abc', revision: 1, source: 'Generated', difficulty: 'Hard' }),
    { key: 'quick:Hard', kind: 'quick', meta: { difficulty: 'Hard' } })
  assert.deepEqual(sudokuBoardKey({ id: 'first-light', revision: 3, source: 'Built-in', difficulty: 'Easy' }),
    { key: 'level:first-light:3', kind: 'level', meta: {}, levelId: 'first-light', levelRevision: 3 })
  assert.deepEqual(sudokuBoardKey({ id: 'pack:budgies:2', revision: 4, source: 'Creator' }),
    { key: 'level:pack:budgies:2:4', kind: 'level', meta: {}, levelId: 'pack:budgies:2', levelRevision: 4 })
})

test('round-trips board keys and rejects malformed keys', () => {
  assert.deepEqual(parseSudokuBoard('quick:Extreme'), { key: 'quick:Extreme', kind: 'quick', meta: { difficulty: 'Extreme' } })
  assert.deepEqual(parseSudokuBoard('level:pack:budgies:2:4'),
    { key: 'level:pack:budgies:2:4', kind: 'level', meta: {}, levelId: 'pack:budgies:2', levelRevision: 4 })
  assert.equal(parseSudokuBoard('quick:Nightmare'), undefined)
  assert.equal(parseSudokuBoard('level:first-light:0'), undefined)
  assert.equal(parseSudokuBoard('other:first-light:1'), undefined)
})

test('the exact puzzle key follows the grid and rules, not the seed', () => {
  const grid = '0'.repeat(80) + '1'
  assert.equal(sudokuPuzzleContent({ grid, ruleset: 1 }), grid + '|1')
  assert.notEqual(sudokuPuzzleContent({ grid, ruleset: 1 }), sudokuPuzzleContent({ grid, ruleset: 2 }))
})

test('only seeded Quick Play levels get a share code', () => {
  assert.equal(sudokuSeedCode({ seed: 'seed', difficulty: 'Medium', generatorVersion: 2 }), 'AV2-M-seed')
  assert.equal(sudokuSeedCode({ seed: 'seed', difficulty: 'Medium' }), undefined)
  assert.equal(sudokuSeedCode({ difficulty: 'Medium', generatorVersion: 2 }), undefined)
  assert.equal(sudokuSeedCode({ seed: 'seed', difficulty: 'Unknown', generatorVersion: 2 }), undefined)
})
