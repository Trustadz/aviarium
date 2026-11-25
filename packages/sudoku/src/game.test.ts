import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGameRegistry } from '../../game-sdk/src/game.js'
import { sudokuGame } from './game.js'
import { validate } from './solver.js'

const seed = 'b'.repeat(64)
const options = { difficulty: 'Medium' as const }

test('the Sudoku definition passes registry validation', () => {
  assert.doesNotThrow(() => validateGameRegistry([{ definition: sudokuGame }]))
  assert.equal(sudokuGame.id, 'sudoku')
  assert.equal(sudokuGame.meta.id, 'sudoku')
  assert.ok(sudokuGame.generation)
  assert.ok(sudokuGame.leaderboard)
  assert.ok(sudokuGame.challenge)
})

test('generation is deterministic and materializes the legacy Quick Play id', async () => {
  const generation = sudokuGame.generation!
  assert.ok(generation.materialize)
  const first = await generation.generate(seed, options)
  const second = await generation.generate(seed, options)
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.grid, second.grid)
  assert.equal(first.difficulty, 'Medium')
  const level = await generation.materialize(seed, options, first)
  assert.equal(level.grid, first.grid)
  assert.equal(level.difficulty, 'Medium')
  assert.equal(level.source, 'Generated')
})

test('save creation and validation preserve the published level contract', async () => {
  const generation = sudokuGame.generation!
  assert.ok(generation.materialize)
  const content = await generation.generate(seed, options)
  assert.ok(content)
  const level = await generation.materialize(seed, options, content)
  const save = sudokuGame.play.save.create(level, { rules: sudokuGame.play.rules.defaults })
  assert.equal(save.level, level.id)
  assert.equal(save.levelRevision, level.revision)
  assert.equal(save.lives, undefined)
  const solution = validate(Array.from(level.grid, Number), 65_000)
  assert.equal(solution.kind, 'unique')
  save.board.entries = solution.solution
  save.completed = true
  save.elapsedMs = 1234
  assert.doesNotThrow(() => sudokuGame.play.save.validate(save, level, { rules: sudokuGame.play.rules.defaults }))
  const result = sudokuGame.leaderboard!.result(level, save, sudokuGame.play.rules.defaults)
  assert.equal(result.value, 1234)
  assert.equal(result.unit, 'ms')
  assert.match(result.puzzleContent, /\|1$/)
})

test('a changed given is rejected with a typed rule error', async () => {
  const generation = sudokuGame.generation!
  assert.ok(generation.materialize)
  const content = await generation.generate(seed, options)
  assert.ok(content)
  const level = await generation.materialize(seed, options, content)
  const save = sudokuGame.play.save.create(level, { rules: sudokuGame.play.rules.defaults })
  const given = Array.from(level.grid, Number).findIndex(value => value !== 0)
  save.board.entries[given] = save.board.entries[given] === 1 ? 2 : 1
  assert.throws(() => sudokuGame.play.save.validate(save, level, { rules: sudokuGame.play.rules.defaults }),
    /fixed_digits_changed/)
})

test('built-in packs materialize and re-verify through the game contract', async () => {
  const builtIn = sudokuGame.packs.builtIn[0]!
  const pack = { id: builtIn.id, revision: builtIn.revision, builtIn: true, data: builtIn.data }
  const levels = sudokuGame.packs.materialize(pack)
  assert.equal(levels.length, builtIn.data.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0))
  const verified = await sudokuGame.packs.verify(builtIn.data, [])
  assert.equal(verified.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0),
    builtIn.data.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0))
})
