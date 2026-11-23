import assert from 'node:assert/strict'
import test from 'node:test'
import { clues, fillsFitClues, matchesClues, randomDifficulties, randomPuzzle, randomSizes, solveByDeduction, starterPack } from './puzzles.js'

test('clues encode separate runs and empty lines', () => {
  assert.deepEqual(clues([1, 1, 2, 1, 0]), [2, 1])
  assert.deepEqual(clues([0, 2]), [0])
})

test('clue feedback detects incompatible fills and ignores blank marks', () => {
  assert.equal(fillsFitClues([0, 1, 0, 1, 0], [1]), false)
  assert.equal(fillsFitClues([0, 1, 1, 0, 0], [1, 1]), false)
  assert.equal(fillsFitClues([2, 1, 2, 1, 2], [1, 1]), true)
  assert.equal(fillsFitClues([2, 2, 2, 2, 2], [5]), true)
  assert.equal(fillsFitClues([0, 1, 0, 0, 0], [0]), false)
})

test('deduction neither guesses at ambiguous clues nor accepts contradictory ones', () => {
  assert.equal(solveByDeduction({ rows: [[1], [1]], columns: [[1], [1]] }), undefined)
  assert.equal(solveByDeduction({ rows: [[2], [0]], columns: [[2], [0]] }), undefined)
})

test('all five pack puzzles solve by deduction without explicit blank marks', () => {
  assert.equal(starterPack.puzzles.length, 5)
  for (const { id, puzzle } of starterPack.puzzles) {
    const result = solveByDeduction(puzzle)
    assert.ok(result, id)
    assert.ok(matchesClues(puzzle, result.cells.map(cell => cell === 1 ? 1 : 0)), id)
  }
})

test('random puzzles match every requested size and difficulty', () => {
  let seed = 42
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const puzzles = new Set<string>()
  for (const size of randomSizes) {
    for (const difficulty of randomDifficulties) {
      for (let index = 0; index < 8; index++) {
        const puzzle = randomPuzzle({ size, difficulty }, random)
        assert.ok(puzzle)
        assert.equal(puzzle.rows.length, size)
        assert.equal(puzzle.columns.length, size)
        const passes = solveByDeduction(puzzle)?.passes
        assert.ok(passes)
        const medium = size === 5 ? 2 : 3
        const hard = size === 5 ? 3 : 5
        assert.equal(passes >= hard ? 'Hard' : passes >= medium ? 'Medium' : 'Easy', difficulty)
        puzzles.add(JSON.stringify(puzzle))
      }
    }
  }
  assert.equal(puzzles.size, 48)
  assert.equal(randomPuzzle({ size: 10, difficulty: 'Hard' }, () => 0), undefined)
})
