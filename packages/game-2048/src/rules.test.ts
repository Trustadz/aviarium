import assert from 'node:assert/strict'
import test from 'node:test'
import { createRandom } from './random.js'
import {
  applyMove, boardFromTiles, emptyBoard, maxTile, moveTiles, noMoves, slideBoard, spawnTile,
  startBoard, tilesFromBoard, type Board, type Direction,
} from './rules.js'

const board = (...values: number[]): Board => values

test('a seed produces the same two starting tiles on every call', () => {
  const first = startBoard('aviarium-seed', 1)
  assert.deepEqual(startBoard('aviarium-seed', 1), first)
  assert.equal(first.filter(Boolean).length, 2)
  assert.ok(first.filter(Boolean).every(value => value === 2 || value === 4))
  assert.notDeepEqual(startBoard('another-seed', 1), first)
})

test('slide merges equal neighbours once and awards the merged value', () => {
  const result = slideBoard(board(
    2, 2, 2, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ), 3)
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0])
  assert.equal(result.gain, 8)
  assert.equal(result.moved, true)
})

test('a tile cannot merge twice in one move', () => {
  const result = slideBoard(board(
    4, 4, 4, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ), 3)
  assert.deepEqual(result.board.slice(0, 4), [8, 4, 0, 0])
  assert.equal(result.gain, 8)
})

test('sliding right uses the opposite traversal order', () => {
  const result = slideBoard(board(
    2, 0, 2, 4,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ), 1)
  assert.deepEqual(result.board.slice(0, 4), [0, 0, 4, 4])
  assert.equal(result.gain, 4)
})

test('a no-op move does not spawn and does not count', () => {
  const random = createRandom('no-op', 1)
  const result = applyMove(board(
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ), 3, random)
  assert.equal(result.moved, false)
  assert.equal(result.spawn, undefined)
  assert.equal(result.gain, 0)
})

test('a counted move spawns exactly one new tile', () => {
  const random = createRandom('spawn', 1)
  const before = board(
    0, 0, 0, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 4,
  )
  const result = applyMove(before, 3, random)
  assert.equal(result.moved, true)
  assert.equal(result.board.filter(Boolean).length, before.filter(Boolean).length + 1)
  assert.ok([2, 4].includes(result.spawn!.value))
})

test('spawn is deterministic for the same seed and move sequence', () => {
  const play = () => {
    const random = createRandom('same-spawn', 1)
    let state: Board = startBoard('same-spawn', 1)
    const moves: number[] = []
    for (const direction of [3, 0, 1, 2, 3, 0] as Direction[]) {
      const result = applyMove(state, direction, random)
      if (!result.moved) continue
      state = result.board
      moves.push(state.filter(Boolean).length)
    }
    return { state, moves }
  }
  assert.deepEqual(play(), play())
})

test('game over requires a full board with no equal neighbours', () => {
  assert.equal(noMoves(board(
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  )), true)
  assert.equal(noMoves(board(
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 2, 4,
  )), false)
  assert.equal(noMoves(board(
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 0,
  )), false)
})

test('a merge into 2048 is reported as the goal', () => {
  const result = slideBoard(board(
    1024, 1024, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ), 3)
  assert.equal(result.reached2048, true)
  assert.equal(maxTile(result.board), 2048)
})

test('tile positions survive a move so the browser can animate them', () => {
  const tiles = tilesFromBoard(board(
    2, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ))
  const moved = moveTiles(tiles, 1)
  assert.equal(moved.moved, true)
  assert.equal(moved.tiles[0]!.id, tiles[0]!.id)
  assert.equal(moved.tiles[0]!.col, 3)
  assert.deepEqual(boardFromTiles(moved.tiles), [0, 0, 0, 2, ...emptyBoard().slice(4)])
})

test('spawn refuses a full board', () => {
  assert.throws(() => spawnTile(board(
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ), () => 0.5), /full board/)
})

test('the tile renderer and the pure board engine agree on every move', () => {
  const random = createRandom('renderer-parity', 1)
  const values = [0, 0, 0, 2, 2, 4, 8, 16, 32, 64]
  for (let sample = 0; sample < 800; sample += 1) {
    const state = Array.from({ length: 16 }, () => values[Math.floor(random() * values.length)]!)
    for (const direction of [0, 1, 2, 3] as Direction[]) {
      const pure = slideBoard(state, direction)
      const visual = moveTiles(tilesFromBoard(state), direction)
      assert.deepEqual(boardFromTiles(visual.tiles), pure.board, 'direction ' + direction + ' on ' + state.join(','))
      assert.equal(visual.gain, pure.gain, 'gain for direction ' + direction)
      assert.equal(visual.moved, pure.moved, 'moved for direction ' + direction)
      assert.equal(visual.reached2048, pure.reached2048, 'goal for direction ' + direction)
    }
  }
})

test('a merged partner stays in the tile list and slides to the merge target', () => {
  const tiles = tilesFromBoard(board(
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ))
  const moved = moveTiles(tiles, 3)
  assert.equal(moved.moved, true)
  assert.equal(moved.tiles.length, 2)
  assert.deepEqual(moved.tiles.map(tile => ({ value: tile.value, nextValue: tile.nextValue, col: tile.col,
    removing: Boolean(tile.removing) })),
    [{ value: 2, nextValue: 4, col: 0, removing: false }, { value: 2, nextValue: undefined, col: 0, removing: true }])
  assert.deepEqual(boardFromTiles(moved.tiles).slice(0, 4), [4, 0, 0, 0])
})
