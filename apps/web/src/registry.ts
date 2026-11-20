import { sudoku } from '../../../packages/sudoku/src/metadata.js'

export const games = [{ ...sudoku, url: '/games/sudoku', player: () => import('./Player.js') }] as const
