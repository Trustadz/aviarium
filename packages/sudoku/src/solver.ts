import type { Difficulty, Validation } from '../../game-sdk/src/index.js'
import { bit, box, candidateMasks, cells, column, conflicts, FULL, row, units } from './rules.js'

const counts = Array.from({ length: FULL + 1 }, (_, value) => value.toString(2).replace(/0/g, '').length)
const digitOf = (mask: number) => 32 - Math.clz32(mask)

export function validate(input: readonly number[], budget = 150_000): Validation<number[]> {
  if (input.length !== 81 || !cells.every(cell => Number.isInteger(input[cell]) && input[cell] >= 0 && input[cell] <= 9))
    return { kind: 'invalid', reason: 'Enter exactly 81 digits using 0 for blanks.' }
  if (conflicts(input).size) return { kind: 'invalid', reason: 'The givens repeat a digit in a row, column, or box.' }

  const grid = [...input]
  const masks = Array<number>(27).fill(0)
  const indexes = cells.map(cell => [row(cell), 9 + column(cell), 18 + box(cell)])
  const options = (cell: number) => FULL & ~indexes[cell].reduce((mask, index) => mask | masks[index], 0)
  let solution: number[] | undefined
  let found = 0
  let cutoff = false
  function toggle(cell: number, digit: number) {
    for (const index of indexes[cell]) masks[index] ^= bit(digit)
  }
  for (const cell of cells) if (grid[cell]) toggle(cell, grid[cell])
  function search() {
    if (found === 2 || cutoff) return
    if (--budget < 0) { cutoff = true; return }
    let best = -1
    let choices = 0
    for (const cell of cells) {
      if (grid[cell]) continue
      const mask = options(cell)
      if (!mask) return
      if (best < 0 || counts[mask] < counts[choices]) { best = cell; choices = mask }
      if (counts[choices] === 1) break
    }
    if (best === -1) { solution ??= [...grid]; found++; return }
    while (choices && found < 2 && !cutoff) {
      const lowest = choices & -choices
      const digit = digitOf(lowest)
      choices ^= lowest
      grid[best] = digit
      toggle(best, digit)
      search()
      toggle(best, digit)
      grid[best] = 0
    }
  }
  search()
  if (found === 2 && solution) return { kind: 'multiple', solution }
  if (cutoff) return { kind: 'inconclusive', solution }
  return solution ? { kind: 'unique', solution } : { kind: 'unsolvable' }
}

export type Step = { cell: number; digit: number } & (
  { technique: 'Naked single' | 'Guess or search' } |
  { technique: 'Hidden single'; unit: 'row' | 'column' | 'box' }
)
export function analyze(input: readonly number[], solution?: readonly number[]) {
  const grid = [...input]
  const steps: Step[] = []
  let advanced = 0
  while (grid.includes(0)) {
    const masks = candidateMasks(grid)
    let step: Step | undefined
    const single = masks.findIndex(mask => counts[mask] === 1)
    if (single >= 0) step = { cell: single, digit: digitOf(masks[single]), technique: 'Naked single' }
    if (!step) {
      for (const [index, unit] of units.entries()) {
        for (let digit = 1; digit <= 9; digit++) {
          const matches = unit.filter(cell => masks[cell] & bit(digit))
          if (matches.length === 1) {
            const unitType = index < 9 ? 'row' : index < 18 ? 'column' : 'box'
            step = { cell: matches[0], digit, technique: 'Hidden single', unit: unitType }
            break
          }
        }
        if (step) break
      }
      if (step) advanced++
    }
    if (!step) {
      const cell = grid.indexOf(0)
      if (!solution) break
      step = { cell, digit: solution[cell], technique: 'Guess or search' }
    }
    grid[step.cell] = step.digit
    steps.push(step)
  }
  const difficulty: Difficulty = grid.includes(0) || steps.some(step => step.technique === 'Guess or search')
    ? 'Hard' : advanced > 0 ? 'Medium' : 'Easy'
  return { difficulty, steps }
}

function seeded(seed: string) {
  let state = 2166136261
  for (const char of seed) state = Math.imul(state ^ char.codePointAt(0)!, 16777619)
  state ||= 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

export function generate(seed: string, difficulty: Difficulty, unique = true) {
  const random = seeded(seed)
  function shuffle<T>(input: readonly T[]): T[] {
    const list = [...input]
    for (let index = list.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1))
      ;[list[index], list[swap]] = [list[swap], list[index]]
    }
    return list
  }
  const groups = () => shuffle([0, 1, 2]).flatMap(group => shuffle([0, 1, 2]).map(index => 3 * group + index))
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = groups()
    const columns = groups()
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const grid = cells.map(cell => {
      const r = rows[row(cell)]
      return digits[(3 * r + Math.floor(r / 3) + columns[column(cell)]) % 9]
    })
    for (const cell of shuffle(cells)) {
      const value = grid[cell]
      grid[cell] = 0
      const result = validate(grid, 12_000)
      if (result.kind !== 'unique' && (unique || result.kind !== 'multiple')) { grid[cell] = value; continue }
      const grade = analyze(grid, result.solution).difficulty
      if (grid.filter(value => !value).length >= 34 && grade === difficulty)
        return { grid: grid.join(''), difficulty: grade, seed, generatorVersion: 1, validation: result.kind }
    }
  }
  return undefined
}
