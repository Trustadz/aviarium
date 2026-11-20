import assert from 'node:assert/strict'
import test from 'node:test'
import { starterCatalog } from './catalog.js'
import { bit, parseGrid, rules } from './rules.js'
import { analyze, generate, validate } from './solver.js'

const start = Array.from(starterCatalog[0].grid, Number)
test('published level fixtures are reproducibly graded and uniquely solvable', () => {
  for (const level of starterCatalog) {
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
test('generates deterministic validated levels for every requested difficulty', () => {
  for (const level of starterCatalog) {
    const seed = 'aviarium-v1:' + level.id
    const generated = generate(seed, level.difficulty)
    assert.ok(generated)
    assert.equal(generated.grid, level.grid)
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
