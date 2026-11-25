import assert from 'node:assert/strict'
import test from 'node:test'
import { challengeGames } from './challenges/registry.js'

const seed = 'a'.repeat(64)
const sudokuRecipe = {
  seriesId: 'daily', occurrenceId: '00000000-0000-4000-8000-000000000000', periodKey: '2026-11-24',
  game: 'sudoku', seed,
  selection: { groups: { difficulty: 'Medium' }, options: { difficulty: 'Medium' }, rules: {} },
}
const nonogramRecipe = {
  seriesId: 'daily', occurrenceId: '00000000-0000-4000-8000-000000000000', periodKey: '2026-11-24',
  game: 'nonograms', seed,
  selection: { groups: { size: '10', difficulty: 'Medium' }, options: { size: 10, difficulty: 'Medium' }, rules: {} },
}

test('the challenge registry is derived from the game registry', () => {
  assert.deepEqual(challengeGames.map(game => game.id), ['sudoku', 'nonograms'])
  for (const game of challengeGames) {
    assert.ok(game.optionGroups.length > 0)
    for (const group of game.optionGroups) {
      assert.ok(group.choices.length > 0)
      assert.ok(group.defaultEnabled.length > 0)
    }
  }
})

test('Sudoku challenge generation is deterministic and records elapsed time', async () => {
  const sudoku = challengeGames.find(game => game.id === 'sudoku')!
  const first = await sudoku.generate(sudokuRecipe)
  const second = await sudoku.generate(sudokuRecipe)
  assert.equal(first.grid?.length, 81)
  assert.equal(first.grid, second.grid)
  assert.equal(first.difficulty, 'Medium')
  const save = {
    game: 'sudoku', level: 'challenge-test', levelRevision: 1, ruleset: 1, format: 1,
    board: { entries: Array(81).fill(0), notes: Array(81).fill(0) }, undo: [], redo: [],
    elapsedMs: 1234, completed: true, aids: { hints: true, autoNotes: true, mistakes: true },
  }
  const result = sudoku.record({ ...first, id: 'challenge-test', revision: 1, source: 'Challenge' }, save, {})
  assert.equal(result.value, 1234)
  assert.equal(result.unit, 'ms')
  assert.match(result.puzzleContent, /\|1$/)
})

test('Nonograms challenge generation is deterministic and records elapsed time', async () => {
  const nonograms = challengeGames.find(game => game.id === 'nonograms')!
  const first = await nonograms.generate(nonogramRecipe)
  const second = await nonograms.generate(nonogramRecipe)
  const content = first.content as { rows: number[][]; columns: number[][] }
  assert.equal(content.rows.length, 10)
  assert.equal(content.columns.length, 10)
  assert.deepEqual(content, second.content)
  assert.equal(first.difficulty, 'Medium')
  const save = {
    game: 'nonograms', level: 'challenge-test', levelRevision: 1, ruleset: 1, format: 1,
    elapsedMs: 4321, completed: true, board: Array(100).fill(0), undo: [],
  }
  const result = nonograms.record({ ...first, id: 'challenge-test', revision: 1, source: 'Challenge' }, save, {})
  assert.equal(result.value, 4321)
  assert.equal(result.unit, 'ms')
  assert.ok(result.puzzleContent.includes(';'))
})
