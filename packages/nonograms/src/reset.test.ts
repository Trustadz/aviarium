import assert from 'node:assert/strict'
import test from 'node:test'
import { resetNonogramInput, type NonogramSave } from './contracts.js'
import type { Cell } from './puzzles.js'

const size = 5
const filled = Array.from({ length: size * size }, (_, index): Cell =>
  index % 3 === 0 ? 1 : index % 3 === 1 ? 2 : 0)

function save(overrides: Partial<NonogramSave> = {}): NonogramSave {
  return {
    game: 'nonograms', level: 'egg', levelRevision: 1, ruleset: 1, format: 1,
    elapsedMs: 4_321, completed: false, packRevision: 2,
    board: [...filled], undo: [Array<Cell>(size * size).fill(0)],
    ...overrides,
  }
}

test('resetting Nonogram input clears marks and undo only', () => {
  const original = save()
  const reset = resetNonogramInput(original)
  assert.deepEqual(reset.board, Array(size * size).fill(0))
  assert.deepEqual(reset.undo, [])
  assert.equal(reset.elapsedMs, original.elapsedMs)
  assert.equal(reset.completed, original.completed)
  assert.equal(reset.completedAt, original.completedAt)
  assert.equal(reset.level, original.level)
  assert.equal(reset.levelRevision, original.levelRevision)
  assert.equal(reset.packRevision, original.packRevision)
  // The save handed in is untouched.
  assert.deepEqual(original.board, filled)
})

test('resetting Nonogram input leaves a solved run unavailable', () => {
  const solved = save({ completed: true, completedAt: 1_700_000_000_000 })
  assert.equal(resetNonogramInput(solved), solved)
})
