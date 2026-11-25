import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGameRegistry } from '../../game-sdk/src/game.js'
import { hintCooldownMs, hintCooldownRemaining } from './contracts.js'
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

test('hints used is reported with the result but never changes the value', async () => {
  const generation = sudokuGame.generation!
  assert.ok(generation.materialize)
  const content = await generation.generate(seed, options)
  assert.ok(content)
  const level = await generation.materialize(seed, options, content)
  const save = sudokuGame.play.save.create(level, { rules: sudokuGame.play.rules.defaults })
  assert.equal(save.hintsUsed, 0)
  save.elapsedMs = 4321
  save.hintsUsed = 2
  save.aids = { hints: true, autoNotes: true, mistakes: false }
  const result = sudokuGame.leaderboard!.result(level, save, sudokuGame.play.rules.defaults)
  assert.equal(result.value, 4321)
  assert.deepEqual(result.aids, { hints: true, autoNotes: true, mistakes: false, hintsUsed: 2 })

  save.hintsUsed = undefined
  assert.deepEqual(sudokuGame.leaderboard!.result(level, save, sudokuGame.play.rules.defaults).aids, save.aids)
})

test('a used hint cools down before another hint is available', () => {
  assert.equal(hintCooldownMs, 10_000)
  assert.equal(hintCooldownRemaining({ hintCooldownUntil: 25_000 }, 20_000), 5_000)
  assert.equal(hintCooldownRemaining({ hintCooldownUntil: 20_000 }, 20_000), 0)
  assert.equal(hintCooldownRemaining({ hintCooldownUntil: 19_000 }, 20_000), 0)
  assert.equal(hintCooldownRemaining({}, 20_000), 0)
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
  assert.equal(levels.length, builtIn.data.puzzles.length)
  const verified = await sudokuGame.packs.verify(builtIn.data, [])
  assert.equal(verified.puzzles.length, builtIn.data.puzzles.length)
})
