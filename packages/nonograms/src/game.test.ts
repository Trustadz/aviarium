import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGameRegistry } from '../../game-sdk/src/game.js'
import { fromPicture, randomDifficulties, randomSizes } from './puzzles.js'
import { nonogramsGame } from './game.js'
import type { NonogramLevel } from './contracts.js'

const picture = ['..#..', '..#..', '#####', '..#..', '..#..']
const puzzle = fromPicture(picture)
const level: NonogramLevel = {
  game: 'nonograms', id: 'fixture-nonogram', revision: 1, ruleset: 1, title: 'Fixture',
  source: 'Generated', content: puzzle, difficulty: 'Easy',
}
const options = { size: 5 as const, difficulty: 'Easy' as const }

test('the Nonograms definition passes registry validation', () => {
  assert.doesNotThrow(() => validateGameRegistry([{ definition: nonogramsGame }]))
  assert.equal(nonogramsGame.id, 'nonograms')
  assert.equal(nonogramsGame.meta.id, 'nonograms')
  assert.ok(nonogramsGame.generation)
  assert.ok(nonogramsGame.leaderboard)
  assert.ok(nonogramsGame.challenge)
})

test('Nonograms generation is deterministic and materializes a content level', async () => {
  const generation = nonogramsGame.generation!
  assert.ok(generation.materialize)
  const first = await generation.generate('c'.repeat(64), options)
  const second = await generation.generate('c'.repeat(64), options)
  assert.ok(first)
  assert.ok(second)
  assert.deepEqual(first.content, second.content)
  assert.equal(first.difficulty, 'Easy')
  const materialized = await generation.materialize('c'.repeat(64), options, first)
  assert.deepEqual(materialized.content, first.content)
  assert.equal(materialized.source, 'Generated')
})

test('Nonograms save creation/validation and result use the level content', () => {
  const save = nonogramsGame.play.save.create(level, { rules: nonogramsGame.play.rules.defaults })
  save.board = picture.flatMap(row => Array.from(row, cell => cell === '#' ? 1 : 0))
  save.completed = true
  save.elapsedMs = 4321
  assert.doesNotThrow(() => nonogramsGame.play.save.validate(save, level, { rules: nonogramsGame.play.rules.defaults }))
  const result = nonogramsGame.leaderboard!.result(level, save, nonogramsGame.play.rules.defaults)
  assert.equal(result.value, 4321)
  assert.equal(result.unit, 'ms')
  assert.ok(result.puzzleContent.includes(';'))
})

test('a completed save that does not match the clues is rejected', () => {
  const save = nonogramsGame.play.save.create(level, { rules: nonogramsGame.play.rules.defaults })
  save.board = Array(25).fill(0)
  save.completed = true
  assert.throws(() => nonogramsGame.play.save.validate(save, level, { rules: nonogramsGame.play.rules.defaults }),
    /saved_solution_invalid/)
})

test('built-in Nonogram packs materialize and verify through the contract', async () => {
  const builtIn = nonogramsGame.packs.builtIn[0]!
  const pack = { id: builtIn.id, revision: builtIn.revision, builtIn: true, data: builtIn.data }
  const levels = nonogramsGame.packs.materialize(pack)
  assert.equal(levels.length, builtIn.data.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0))
  const verified = await nonogramsGame.packs.verify(builtIn.data, [])
  assert.equal(verified.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0),
    builtIn.data.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0))
  assert.ok(randomSizes.includes(5) && randomDifficulties.includes('Easy'))
})
