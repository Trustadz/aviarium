import type { WebGame } from './game-web.js'
import { nonogramsWeb } from './nonograms-web.js'
import { sudokuWeb } from './sudoku-web.js'

export const games: readonly WebGame[] = [sudokuWeb, nonogramsWeb].map(game => ({ ...game, url: '/games/' + game.id }))
export const findGame = (id: string) => games.find(game => game.id === id)
