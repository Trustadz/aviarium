import type { Difficulty } from '../../game-sdk/src/index.js'
import { gradePuzzle } from './logic.js'
import { quickPlayGrids } from './quick-play-grids.js'
import { seeded } from './solver.js'

export { quickPlayVersion } from './contracts.js'

export function generateQuickPuzzle(seed: string, difficulty: Difficulty) {
  // Keep the grid pools, tactics and permutation algorithm fixed for this version.
  const random = seeded(seed)
  function shuffle<T>(source: readonly T[]) {
    const list = [...source]
    for (let index = list.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1))
      ;[list[index], list[swap]] = [list[swap], list[index]]
    }
    return list
  }
  const grids = shuffle(quickPlayGrids[difficulty])
  const groups = [0, 1, 2]
  const order = () => shuffle(groups).flatMap(group => shuffle(groups).map(index => group * 3 + index))
  for (const base of grids) {
    const rows = order()
    const cols = order()
    const digits = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])]
    const grid = rows.flatMap(row => cols.map(col => digits[Number(base[row * 9 + col])]))
    // Symmetries preserve uniqueness. Tie-breaking between logical steps can change the grade.
    if (gradePuzzle(grid).difficulty === difficulty) return grid.join('')
  }
  return grids[0]
}
