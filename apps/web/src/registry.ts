import { sudoku } from '../../../packages/sudoku/src/metadata.js'

import { SudokuPreview } from './Grid.js'

export const games = [{ ...sudoku, url: '/games/sudoku', theme: 'sudoku-theme', Preview: SudokuPreview, player: () => import('./Player.js') }] as const
