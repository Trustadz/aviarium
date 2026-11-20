import type { GameRules } from '../../game-sdk/src/index.js'

export const SIZE = 81
export const FULL = 0x1ff
export const cells = Array.from({ length: SIZE }, (_, cell) => cell)
export const row = (cell: number) => Math.floor(cell / 9)
export const column = (cell: number) => cell % 9
export const box = (cell: number) => 3 * Math.floor(row(cell) / 3) + Math.floor(column(cell) / 3)
export const bit = (digit: number) => 1 << (digit - 1)
export const units = [row, column, box].flatMap(group =>
  Array.from({ length: 9 }, (_, i) => cells.filter(cell => group(cell) === i)),
)
export const peers = cells.map(cell => cells.filter(other => other !== cell &&
  (row(cell) === row(other) || column(cell) === column(other) || box(cell) === box(other))))

export function parseGrid(text: string): number[] | undefined {
  const normalized = text.replace(/[\s|+\-]/g, '').replace(/\./g, '0')
  return /^[0-9]{81}$/.test(normalized) ? Array.from(normalized, Number) : undefined
}

export function conflicts(grid: readonly number[]): Set<number> {
  return new Set(cells.filter(cell => grid[cell] && peers[cell].some(other => grid[cell] === grid[other])))
}

export interface Board { entries: number[]; notes: number[] }
export interface Move { cell: number; digit: number; note?: boolean; autoNoteDeletion?: boolean }

export function candidateMasks(entries: readonly number[]): number[] {
  return cells.map(cell => entries[cell] ? 0 : peers[cell].reduce((mask, peer) =>
    entries[peer] ? mask & ~bit(entries[peer]) : mask, FULL))
}

export const rules: GameRules<readonly number[], Board, Move, readonly number[]> = {
  ruleset: 1,
  saveFormat: 1,
  create: level => ({ entries: [...level], notes: cells.map(() => 0) }),
  apply(level, state, { cell, digit, note, autoNoteDeletion = true }) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE || level[cell] ||
        !Number.isInteger(digit) || digit < 0 || digit > 9) return state
    if (note && digit) {
      if (state.entries[cell]) return state
      const notes = [...state.notes]
      notes[cell] ^= bit(digit)
      return { ...state, notes }
    }
    if (state.entries[cell] === digit && !state.notes[cell]) return state
    const entries = [...state.entries]
    const notes = [...state.notes]
    entries[cell] = digit
    notes[cell] = 0
    if (digit && autoNoteDeletion) for (const peer of peers[cell]) notes[peer] &= ~bit(digit)
    return { entries, notes }
  },
  verify(level, candidate) {
    return candidate.length === SIZE && cells.every(cell =>
      Number.isInteger(candidate[cell]) && candidate[cell] >= 1 && candidate[cell] <= 9 &&
      (!level[cell] || candidate[cell] === level[cell])) && conflicts(candidate).size === 0
  },
}
