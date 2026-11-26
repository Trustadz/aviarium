import { sudoku } from '../../packages/sudoku/src/metadata.js'

export const offlineGames = [{
  id: sudoku.id,
  entries: ['/src/Player.tsx', '/src/SudokuStudio.tsx'],
  workers: ['quick-play-worker', 'studio-check-worker'],
}, {
  id: 'nonograms',
  entries: ['/src/Nonograms.tsx', '/src/NonogramsStudio.tsx'],
  workers: [],
}, {
  id: '2048',
  entries: ['/src/Twenty48.tsx'],
  workers: [],
}] as const
