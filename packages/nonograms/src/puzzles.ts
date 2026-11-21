export type Cell = 0 | 1 | 2
type Line = readonly number[]

export type Puzzle = {
  rows: number[][]
  columns: number[][]
}

export function clues(line: readonly number[]): number[] {
  const runs: number[] = []
  let length = 0
  for (const cell of [...line, 0]) {
    if (cell === 1) length++
    else if (length) {
      runs.push(length)
      length = 0
    }
  }
  return runs.length ? runs : [0]
}

function fromPicture(picture: readonly string[]): Puzzle {
  const pixels = picture.map(row => Array.from(row, cell => Number(cell === '#')))
  return {
    rows: pixels.map(clues),
    columns: pixels[0].map((_, column) => clues(pixels.map(row => row[column]))),
  }
}

export const starterPuzzles = [
  { id: 'heart', title: 'Heart', puzzle: fromPicture(['.#.#.', '#####', '#####', '.###.', '..#..']) },
  { id: 'owl', title: 'Owl', puzzle: fromPicture(['#...#', '#####', '#.#.#', '.###.', '.#.#.']) },
  { id: 'perched-bird', title: 'Perched bird', puzzle: fromPicture([
    '.....###..',
    '....######',
    '....####..',
    '...#####..',
    '..######..',
    '.######...',
    '#####.....',
    '..##......',
    '...#......',
    '.######...',
  ]) },
] as const

function patterns(size: number, runs: Line): number[] {
  if (runs[0] === 0) return [0]
  const masks: number[] = []
  const remaining = runs.map((_, index) => runs.slice(index).reduce((sum, length) => sum + length + 1, -1))
  function place(index: number, start: number, mask: number) {
    if (index === runs.length) {
      masks.push(mask)
      return
    }
    const run = runs[index]
    for (let offset = start; offset <= size - remaining[index]; offset++)
      place(index + 1, offset + run + 1, mask | (((1 << run) - 1) << offset))
  }
  place(0, 0, 0)
  return masks
}

// A cell shared by every remaining pattern in a line is forced. If this
// determines the whole board, every solution must be that board.
export function solveByDeduction(puzzle: Puzzle) {
  const width = puzzle.columns.length
  const height = puzzle.rows.length
  const cells: Cell[] = Array(width * height).fill(0)
  const lines = [
    ...puzzle.rows.map((runs, row) => ({ runs, indexes: puzzle.columns.map((_, col) => row * width + col) })),
    ...puzzle.columns.map((runs, col) => ({ runs, indexes: puzzle.rows.map((_, row) => row * width + col) })),
  ].map(({ runs, indexes }) => ({ indexes, possible: patterns(indexes.length, runs) }))

  let passes = 0
  while (true) {
    let changed = false
    for (const line of lines) {
      line.possible = line.possible.filter(mask => line.indexes.every((index, offset) =>
        !cells[index] || cells[index] === ((mask & (1 << offset)) ? 1 : 2)))
      if (!line.possible.length) return
      const filled = line.possible.reduce((all, mask) => all & mask)
      const maybeFilled = line.possible.reduce((any, mask) => any | mask)
      line.indexes.forEach((index, offset) => {
        if (cells[index]) return
        const bit = 1 << offset
        if (filled & bit) cells[index] = 1
        else if (!(maybeFilled & bit)) cells[index] = 2
        if (cells[index]) changed = true
      })
    }
    if (!changed) return
    passes++
    if (cells.every(Boolean)) return matchesClues(puzzle, cells) ? { cells, passes } : undefined
  }
}

export function matchesClues(puzzle: Puzzle, cells: readonly Cell[]) {
  const width = puzzle.columns.length
  const matches = (line: readonly Cell[], runs: Line) => clues(line).join(',') === runs.join(',')
  return puzzle.rows.every((runs, row) => matches(cells.slice(row * width, (row + 1) * width), runs)) &&
    puzzle.columns.every((runs, col) => matches(puzzle.rows.map((_, row) => cells[row * width + col]), runs))
}

export function randomPuzzle(random = Math.random): Puzzle | undefined {
  for (let attempt = 0; attempt < 160; attempt++) {
    const density = 0.52 + random() * 0.16
    const picture = Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => random() < density ? '#' : '.').join(''))
    const puzzle = fromPicture(picture)
    const solved = solveByDeduction(puzzle)
    if (solved && solved.passes >= 3) return puzzle
  }
}
