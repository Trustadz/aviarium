import assert from 'node:assert/strict'
import test from 'node:test'
import { isUntouched } from './attempt.js'
import type { GameAttempt } from '../../../packages/game-sdk/src/progress.js'

type TestAttempt = GameAttempt & {
  board: { entries: number[]; notes: number[] }
  undo: unknown[]
  redo: unknown[]
}

function attempt(overrides: Partial<TestAttempt> = {}): TestAttempt {
  return {
    game: 'sudoku', level: 'puzzle-1', levelRevision: 1, ruleset: 1, format: 1,
    board: { entries: Array(81).fill(0), notes: Array(81).fill(0) },
    undo: [], redo: [], elapsedMs: 0, completed: false,
    ...overrides,
  }
}

test('time bookkeeping does not count as a move, but completion does', () => {
  assert.equal(isUntouched(attempt(), attempt({ elapsedMs: 5_000 })), true)
  assert.equal(isUntouched(attempt(), attempt({ completed: true, completedAt: 1 })), false)
})

test('a board, note, life, or completion change is a real move', () => {
  assert.equal(isUntouched(attempt(), attempt({ board: { entries: [1, ...Array(80).fill(0)], notes: Array(81).fill(0) } })), false)
  assert.equal(isUntouched(attempt(), attempt({ undo: [{}] })), false)
  assert.equal(isUntouched(attempt(), attempt({ lives: 2 })), false)
  assert.equal(isUntouched(attempt(), attempt({ aids: { hints: true } })), true)
})
