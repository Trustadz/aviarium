import assert from 'node:assert/strict'
import test from 'node:test'
import { starterCatalog } from './catalog.js'
import { resetSudokuInput, type SudokuSave } from './contracts.js'

const level = starterCatalog[0]
const givens = Array.from(level.grid, Number)

function save(overrides: Partial<SudokuSave> = {}): SudokuSave {
  const entries = [...givens]
  const empty = entries.findIndex(value => value === 0)
  entries[empty] = 5
  return {
    game: 'sudoku', level: level.id, levelRevision: level.revision, ruleset: 1, format: 1,
    board: { entries, notes: Array(81).fill(511) },
    undo: [{ entries: [...entries], notes: Array(81).fill(0) }],
    redo: [{ entries: [...givens], notes: Array(81).fill(0) }],
    elapsedMs: 12_345, completed: false,
    lives: 2,
    aids: { hints: true, autoNotes: false, mistakes: true },
    packRevision: 7,
    ...overrides,
  }
}

test('resetting Sudoku input restores givens and clears history only', () => {
  const original = save()
  const reset = resetSudokuInput(original, givens)
  assert.deepEqual(reset.board.entries, givens)
  assert.deepEqual(reset.board.notes, Array(81).fill(0))
  assert.deepEqual(reset.undo, [])
  assert.deepEqual(reset.redo, [])
  assert.equal(reset.elapsedMs, original.elapsedMs)
  assert.equal(reset.lives, original.lives)
  assert.deepEqual(reset.aids, original.aids)
  assert.equal(reset.completed, original.completed)
  assert.equal(reset.completedAt, original.completedAt)
  assert.equal(reset.level, original.level)
  assert.equal(reset.levelRevision, original.levelRevision)
  assert.equal(reset.packRevision, original.packRevision)
  assert.equal(reset.ruleset, original.ruleset)
  // The save handed in is untouched.
  assert.notDeepEqual(original.board.entries, givens)
})

test('resetting Sudoku input leaves a finished run unavailable', () => {
  const solved = save({ completed: true, completedAt: 1_700_000_000_000 })
  assert.equal(resetSudokuInput(solved, givens), solved)
  const failed = save({ lives: 0 })
  assert.equal(resetSudokuInput(failed, givens), failed)
})
