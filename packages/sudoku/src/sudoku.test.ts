import assert from 'node:assert/strict'
import test from 'node:test'
import { difficulties } from '../../game-sdk/src/index.js'
import { gradePuzzle } from './logic.js'
import { generateQuickPuzzle } from './quick-play.js'
import { quickPlayGrids } from './quick-play-grids.js'
import { formatSeedCode, parseSeedCode } from './seed-code.js'
import { bit, candidateMasks, FULL, parseGrid, rules } from './rules.js'
import { analyze, generate, validate } from './solver.js'

// Historical built-in grids kept as grading fixtures now that every shipped level lives in a pack.
const publishedFixtures = [
  { id: 'easy', difficulty: 'Easy' as const,
    grid: '298541700703980005000030089429100800006290350300008002540316908031879004087405603' },
  { id: 'medium', difficulty: 'Medium' as const,
    grid: '700000060000010870650007004040070029030000107010002050002950600000003945405000000' },
  { id: 'hard', difficulty: 'Hard' as const,
    grid: '050907003907630400630008000000000000070016240010204300093000700000090856000702130' },
]

const start = Array.from(publishedFixtures[0].grid, Number)
test('published level fixtures are reproducibly graded and uniquely solvable', () => {
  for (const level of publishedFixtures) {
    const grid = Array.from(level.grid, Number)
    const result = validate(grid)
    assert.equal(result.kind, 'unique')
    if (result.kind !== 'unique') continue
    assert.equal(rules.verify(grid, result.solution), true)
    assert.equal(analyze(grid, result.solution).difficulty, level.difficulty)
    const played = [...grid]
    for (const step of analyze(grid, result.solution).steps) played[step.cell] = step.digit
    assert.deepEqual(played, result.solution)
  }
})
test('distinguishes invalid, multiple, exhausted and proven unsolvable', () => {
  assert.equal(validate([1]).kind, 'invalid')
  assert.equal(validate(Array(81).fill(1)).kind, 'invalid')
  assert.equal(validate(Array(81).fill(0)).kind, 'multiple')
  assert.equal(validate(start, 0).kind, 'inconclusive')
  const unsolvable = [...start]
  unsolvable[7] = 6
  assert.equal(validate(unsolvable).kind, 'unsolvable')
})
test('moves preserve givens, support candidates, and reject invalid moves', () => {
  const state = rules.create(start)
  assert.equal(rules.apply(start, state, { cell: 0, digit: 1 }), state)
  assert.equal(rules.apply(start, state, { cell: 81, digit: 1 }), state)
  assert.equal(rules.apply(start, state, { cell: 7, digit: 12 }), state)
  const note = rules.apply(start, state, { cell: 8, digit: 6, note: true })
  assert.equal(note.notes[8], bit(6))
  assert.equal(state.notes[8], 0)
  const move = rules.apply(start, note, { cell: 7, digit: 6 })
  assert.equal(move.entries[7], 6)
  assert.equal(move.notes[8], 0)
  assert.equal(rules.apply(start, move, { cell: 7, digit: 0 }).entries[7], 0)
  assert.equal(rules.verify(start, move.entries), false)
})
test('candidates and automatic note deletion use row, column, and box peers', () => {
  const givens = Array<number>(81).fill(0)
  const board = rules.create(givens)
  const rowPeer = 4, columnPeer = 36, boxPeer = 10, unrelated = 40
  for (const cell of [rowPeer, columnPeer, boxPeer, unrelated]) board.notes[cell] = bit(2) | bit(5)
  const keep = rules.apply(givens, board, { cell: 0, digit: 5, autoNoteDeletion: false })
  assert.deepEqual(keep.notes, board.notes)
  const remove = rules.apply(givens, board, { cell: 0, digit: 5, autoNoteDeletion: true })
  const candidates = candidateMasks(keep.entries)
  for (const cell of [rowPeer, columnPeer, boxPeer]) {
    assert.equal(remove.notes[cell], bit(2))
    assert.equal(candidates[cell], FULL & ~bit(5))
  }
  assert.equal(remove.notes[unrelated], board.notes[unrelated])
  assert.equal(candidates[unrelated], FULL)
  assert.equal(candidates[0], 0)
})
test('generates deterministic validated levels for every requested difficulty', () => {
  for (const level of publishedFixtures) {
    const seed = 'aviarium-v1:' + level.id
    const generated = generate(seed, level.difficulty)
    assert.ok(generated)
    assert.deepEqual(generate(seed, level.difficulty), generated)
    assert.equal(validate(Array.from(generated.grid, Number)).kind, 'unique')
  }
})
test('supports optional uniqueness and common text imports', () => {
  const result = generate('multiple-sample', 'Hard', false)
  assert.ok(result)
  const puzzle = parseGrid(result.grid.replaceAll('0', '.').match(/.{9}/g)!.join('\n'))
  assert.ok(puzzle)
  assert.ok(['unique', 'multiple'].includes(validate(puzzle).kind))
  assert.equal(parseGrid('hello'), undefined)
})

test('Quick Play pools and seeded boards have unique solutions and match all five logical grades', () => {
  for (const difficulty of difficulties) {
    const seed = 'local-budgie-trail'
    const generated = generateQuickPuzzle(seed, difficulty)
    assert.equal(generateQuickPuzzle(seed, difficulty), generated)
    for (const grid of [...quickPlayGrids[difficulty], generated]) {
      const values = Array.from(grid, Number)
      assert.equal(validate(values).kind, 'unique')
      const grade = gradePuzzle(values)
      assert.equal(grade.difficulty, difficulty, grid)
      assert.ok(grade.steps.every(step => step.id !== 'nishio'))
      if (difficulty === 'Genius') assert.ok(grade.extremeFamilies.length >= 3)
    }
  }
  assert.equal(gradePuzzle(Array<number>(81).fill(0)).difficulty, undefined)
})

test('seed codes preserve the original seed, grade and version as plain text', () => {
  for (const difficulty of difficulties) {
    const seed = 'Budgies – Eucalyptus & 2'
    assert.deepEqual(parseSeedCode(formatSeedCode(seed, difficulty, 2)), { seed, difficulty, version: 2 })
  }
  assert.equal(parseSeedCode('https://example.org/sudoku?seed=budgies'), undefined)
  assert.equal(parseSeedCode('AV2-Z-budgies'), undefined)
})
