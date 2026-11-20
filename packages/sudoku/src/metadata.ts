import type { GameMetadata } from '../../game-sdk/src/index.js'

export const sudoku = {
  id: 'sudoku',
  title: 'Sudoku',
  description: 'Fill the grid so each row, column, and box contains the digits 1–9.',
  tags: ['Logic', 'Numbers'],
  eReader: true,
  input: ['keyboard', 'pointer', 'touch'],
} as const satisfies GameMetadata
