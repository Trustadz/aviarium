import { gradePuzzle } from '../../../packages/sudoku/src/logic.js'
import { validate } from '../../../packages/sudoku/src/solver.js'

self.addEventListener('message', (event: MessageEvent<{ grid: string; diagonal: boolean }>) => {
  const grid = Array.from(event.data.grid, Number)
  const diagonal = event.data.diagonal
  const result = validate(grid, 65_000, diagonal)
  self.postMessage({ kind: result.kind, difficulty: result.kind === 'unique' ? gradePuzzle(grid, diagonal).difficulty : undefined })
})
