import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTwenty48Attempt, formatTwenty48SeedCode, parseTwenty48SeedCode, quickTwenty48,
  twenty48SaveSchema, validateTwenty48Attempt,
} from './contracts.js'
import { twenty48Game } from './game.js'
import { twenty48BoardKey, twenty48PuzzleContent, twenty48QuickBoards } from './leaderboards.js'
import { createRandom } from './random.js'
import { applyMove, noMoves, startBoard, type Board, type Direction } from './rules.js'

function playToEnd(seed: string) {
  const level = quickTwenty48(seed, 1)
  const random = createRandom(seed, 1)
  let board: Board = [...level.content.start]
  let score = 0
  const moves: number[] = []
  let direction: Direction = 0
  while (!noMoves(board)) {
    let result = applyMove(board, direction, random)
    let tries = 0
    while (!result.moved && tries < 3) {
      direction = ((direction + 1) % 4) as Direction
      result = applyMove(board, direction, random)
      tries += 1
    }
    if (!result.moved) break
    board = result.board
    score += result.gain
    moves.push(direction)
    direction = ((direction + 1) % 4) as Direction
    if (moves.length > 20_000) throw new Error('test run did not finish')
  }
  return { level, board, score, moves }
}

test('the 2048 definition exposes a save, a generator and a score board', () => {
  assert.equal(twenty48Game.id, '2048')
  assert.equal(twenty48Game.meta.title, '2048')
  assert.ok(twenty48Game.generation)
  assert.ok(twenty48Game.leaderboard)
  assert.deepEqual(twenty48QuickBoards.map(board => board.key), ['quick:classic'])
  assert.equal(twenty48Game.play.save.validate !== undefined, true)
})

test('a generated level reproduces its starting board from the seed', () => {
  const level = quickTwenty48('reproduce-me', 1)
  assert.deepEqual(level.content.start, startBoard('reproduce-me', 1))
  assert.equal(level.content.start.filter(Boolean).length, 2)
  const attempt = createTwenty48Attempt(level)
  assert.equal(attempt.score, 0)
  assert.deepEqual(attempt.moves, [])
  assert.deepEqual(attempt.board, level.content.start)
})

test('a completed save is verified by replaying its moves', () => {
  const { level, board, score, moves } = playToEnd('game-over-seed')
  const save = {
    ...createTwenty48Attempt(level),
    board,
    score,
    moves,
    elapsedMs: 60_000,
    completed: true,
    completedAt: 60_000,
  }
  validateTwenty48Attempt(save, level)
  assert.equal(noMoves(board), true)
})

test('a forged score is rejected', () => {
  const { level, board, score, moves } = playToEnd('forge-score')
  const save = {
    ...createTwenty48Attempt(level),
    board,
    score: score + 100,
    moves,
    elapsedMs: 60_000,
    completed: true,
    completedAt: 60_000,
  }
  assert.throws(() => validateTwenty48Attempt(save, level), /twenty48_score_invalid/)
})

test('a run cannot claim to be finished while a move remains', () => {
  const level = quickTwenty48('not-finished', 1)
  const save = {
    ...createTwenty48Attempt(level),
    elapsedMs: 1000,
    completed: true,
    completedAt: 1000,
  }
  assert.throws(() => validateTwenty48Attempt(save, level), /twenty48_not_finished/)
})

test('a save cannot invent a 2048 milestone', () => {
  const level = quickTwenty48('no-milestone', 1)
  const save = {
    ...createTwenty48Attempt(level),
    elapsedMs: 1000,
    reached2048At: 800,
  }
  assert.throws(() => validateTwenty48Attempt(save, level), /twenty48_goal_invalid/)
})

test('the leaderboard result is a higher-is-better score on the Classic board', () => {
  const level = quickTwenty48('score-board', 1)
  const save = { ...createTwenty48Attempt(level), score: 2048, moves: [], board: level.content.start }
  const result = twenty48Game.leaderboard!.result(level, save, {})
  assert.equal(result.value, 2048)
  assert.equal(result.unit, 'score')
  assert.equal(result.lowerIsBetter, false)
  assert.equal(result.seedCode, formatTwenty48SeedCode('score-board', 1))
  assert.equal(twenty48BoardKey(level).key, 'quick:classic')
  assert.equal(twenty48PuzzleContent(level).includes('score-board'), true)
})

test('a seed code round-trips and a bare seed is accepted', () => {
  const code = formatTwenty48SeedCode('round-trip', 1)
  assert.deepEqual(parseTwenty48SeedCode(code), { seed: 'round-trip', version: 1 })
  assert.deepEqual(parseTwenty48SeedCode('bare-seed'), { seed: 'bare-seed', version: 1 })
  assert.equal(parseTwenty48SeedCode('bad seed!'), undefined)
  assert.equal(parseTwenty48SeedCode('2048-V2-round-trip'), undefined)
})

test('the save schema keeps tile values to powers of two', () => {
  const level = quickTwenty48('schema', 1)
  const save = createTwenty48Attempt(level)
  assert.doesNotThrow(() => twenty48SaveSchema.parse(save))
  assert.throws(() => twenty48SaveSchema.parse({ ...save, board: [3, ...save.board.slice(1)] }))
})
