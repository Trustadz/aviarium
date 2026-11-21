import type { QuickPlayDescriptor } from '../../../packages/sudoku/src/contracts.js'
import { generateQuickPuzzle } from '../../../packages/sudoku/src/quick-play.js'

self.addEventListener('message', (event: MessageEvent<QuickPlayDescriptor>) => {
  const { seed, difficulty } = event.data
  self.postMessage(generateQuickPuzzle(seed, difficulty))
})
