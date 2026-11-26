import { createRandom } from './random.js'

export const boardSize = 4
export const cellCount = boardSize * boardSize
export const targetTile = 2048

/** 0 up, 1 right, 2 down, 3 left. */
export type Direction = 0 | 1 | 2 | 3
export type Board = readonly number[]

export interface Tile {
  id: number
  value: number
  row: number
  col: number
  merged?: boolean
  spawned?: boolean
  /** The merged value, revealed only when the sliding tiles meet. */
  nextValue?: number
  /** Kept through the slide so a merge still reads as two tiles moving together. */
  removing?: boolean
}

export interface MoveResult {
  tiles: Tile[]
  gain: number
  moved: boolean
  reached2048: boolean
}

export interface SpawnResult {
  board: number[]
  tile: Tile
}

const directions: readonly Direction[] = [0, 1, 2, 3]

export function isDirection(value: number): value is Direction {
  return directions.includes(value as Direction)
}

export function emptyBoard(): number[] {
  return Array<number>(cellCount).fill(0)
}

export function boardFromTiles(tiles: readonly Tile[]): number[] {
  const board = emptyBoard()
  for (const tile of tiles) if (!tile.removing)
    board[tile.row * boardSize + tile.col] = tile.nextValue ?? tile.value
  return board
}

export function tilesFromBoard(board: Board, startId = 1): Tile[] {
  const tiles: Tile[] = []
  let id = startId
  for (let index = 0; index < cellCount; index += 1) {
    const value = board[index] ?? 0
    if (value > 0) tiles.push({ id: id++, value, row: Math.floor(index / boardSize), col: index % boardSize })
  }
  return tiles
}

/** The two starting tiles. Two cell draws and two value draws, in that order. */
export function startBoard(seed: string, version?: number): number[] {
  const random = createRandom(seed, version)
  const board = emptyBoard()
  for (let tile = 0; tile < 2; tile += 1) {
    let cell = Math.floor(random() * cellCount)
    while (board[cell] !== 0) cell = Math.floor(random() * cellCount)
    board[cell] = random() < 0.9 ? 2 : 4
  }
  return board
}

export function spawnTile(board: Board, random: () => number): SpawnResult {
  const empty: number[] = []
  for (let index = 0; index < cellCount; index += 1) if (!board[index]) empty.push(index)
  if (!empty.length) throw new Error('2048 cannot spawn on a full board')
  const index = empty[Math.floor(random() * empty.length)]!
  const next = [...board]
  const value = random() < 0.9 ? 2 : 4
  next[index] = value
  return { board: next, tile: { id: 0, value, row: Math.floor(index / boardSize), col: index % boardSize, spawned: true } }
}

function lineIndices(direction: Direction, line: number): number[] {
  const order = direction === 0 || direction === 3 ? [0, 1, 2, 3] : [3, 2, 1, 0]
  return order.map(step => direction === 0 || direction === 2
    ? step * boardSize + line
    : line * boardSize + step)
}

/** Slide and merge once per move. Merges award their resulting value. */
export function slideBoard(board: Board, direction: Direction) {
  const next = emptyBoard()
  let gain = 0
  let moved = false
  const beforeMax = Math.max(...board)
  for (let line = 0; line < boardSize; line += 1) {
    const indices = lineIndices(direction, line)
    const values = indices.map(index => board[index] ?? 0).filter(value => value > 0)
    const merged: number[] = []
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index]!
      if (value === values[index + 1]) {
        merged.push(value * 2)
        gain += value * 2
        index += 1
      } else {
        merged.push(value)
      }
    }
    indices.forEach((index, position) => {
      const value = merged[position] ?? 0
      next[index] = value
      if (value !== (board[index] ?? 0)) moved = true
    })
  }
  return { board: next, gain, moved, reached2048: beforeMax < targetTile && Math.max(...next) >= targetTile }
}

export function noMoves(board: Board) {
  if (board.some(value => value === 0)) return false
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const value = board[row * boardSize + col]
      if (col + 1 < boardSize && value === board[row * boardSize + col + 1]) return false
      if (row + 1 < boardSize && value === board[(row + 1) * boardSize + col]) return false
    }
  }
  return true
}

export function maxTile(board: Board) {
  return Math.max(0, ...board)
}

export function tileCount(board: Board) {
  return board.filter(Boolean).length
}

/**
 * Move a tile list. The returned tiles keep their ids so the browser can
 * animate positions; merging keeps the front tile's id and slides its partner
 * through the merge before removing it.
 */
export function moveTiles(tiles: readonly Tile[], direction: Direction): MoveResult {
  const beforeMax = Math.max(0, ...tiles.map(tile => tile.value))
  const grid = new Map<number, Tile>()
  for (const tile of tiles) grid.set(tile.row * boardSize + tile.col, tile)
  const result: Tile[] = []
  let gain = 0
  let moved = false
  for (let line = 0; line < boardSize; line += 1) {
    const indices = lineIndices(direction, line)
    const lineTiles = indices.map(index => grid.get(index)).filter((tile): tile is Tile => Boolean(tile))
    const merged: { tile: Tile; partner?: Tile }[] = []
    for (let index = 0; index < lineTiles.length; index += 1) {
      const tile = lineTiles[index]!
      const partner = lineTiles[index + 1]
      if (partner && partner.value === tile.value) {
        merged.push({ tile: { ...tile, nextValue: tile.value * 2 },
          partner: { ...partner, removing: true } })
        gain += tile.value * 2
        moved = true
        index += 1
      } else {
        merged.push({ tile: { ...tile } })
      }
    }
    merged.forEach(({ tile, partner }, slot) => {
      const index = indices[slot]!
      const row = Math.floor(index / boardSize)
      const col = index % boardSize
      if (tile.row !== row || tile.col !== col) moved = true
      result.push({ ...tile, row, col })
      if (partner) result.push({ ...partner, row, col, removing: true })
    })
  }
  return { tiles: result, gain, moved,
    reached2048: beforeMax < targetTile && result.some(tile => (tile.nextValue ?? tile.value) >= targetTile) }
}

export function applyMove(board: Board, direction: Direction, random: () => number) {
  const slide = slideBoard(board, direction)
  if (!slide.moved) return { board, gain: 0, moved: false, reached2048: false, spawn: undefined }
  const spawn = spawnTile(slide.board, random)
  return { board: spawn.board, gain: slide.gain, moved: true, reached2048: slide.reached2048, spawn: spawn.tile }
}
