import assert from 'node:assert/strict'
import test from 'node:test'
import { clues, matchesClues, randomPuzzle, solveByDeduction, starterPuzzles } from './puzzles.js'

test('clues encode separate runs and empty lines', () => {
  assert.deepEqual(clues([1, 1, 2, 1, 0]), [2, 1])
  assert.deepEqual(clues([0, 2]), [0])
})

test('deduction neither guesses at ambiguous clues nor accepts contradictory ones', () => {
  assert.equal(solveByDeduction({ rows: [[1], [1]], columns: [[1], [1]] }), undefined)
  assert.equal(solveByDeduction({ rows: [[2], [0]], columns: [[2], [0]] }), undefined)
})

test('starter puzzles solve by deduction and do not require explicit blank marks', () => {
  for (const { id, puzzle } of starterPuzzles) {
    const result = solveByDeduction(puzzle)
    assert.ok(result, id)
    assert.ok(matchesClues(puzzle, result.cells.map(cell => cell === 1 ? 1 : 0)), id)
  }
})

test('random puzzles are full size and require several deduction passes', () => {
  let seed = 42
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const puzzles = new Set<string>()
  for (let index = 0; index < 25; index++) {
    const puzzle = randomPuzzle(random)
    assert.ok(puzzle)
    assert.equal(puzzle.rows.length, 10)
    assert.equal(puzzle.columns.length, 10)
    assert.ok((solveByDeduction(puzzle)?.passes ?? 0) >= 3)
    puzzles.add(JSON.stringify(puzzle))
  }
  assert.equal(puzzles.size, 25)
  assert.equal(randomPuzzle(() => 0), undefined)
})
