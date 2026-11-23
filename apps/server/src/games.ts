import { nonogramsServer } from './nonograms-game.js'
import { sudokuServer } from './sudoku-game.js'

export const serverGames = new Map([sudokuServer, nonogramsServer].map(game => [game.id, game]))
