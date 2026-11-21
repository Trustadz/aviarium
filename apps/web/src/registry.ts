import { sudoku } from '../../../packages/sudoku/src/metadata.js'

import type { GuideSection } from './GameGuide.js'
import { SudokuPreview } from './Grid.js'

const sudokuGuide: readonly GuideSection[] = [
  {
    title: 'The goal',
    paragraphs: [
      'Fill every empty square so each row, column, and 3 × 3 box contains the digits 1 through 9 exactly once. The puzzle gives you some numbers to start with. Those squares are fixed.',
    ],
  },
  {
    title: 'Find your first number',
    paragraphs: [
      'Start with a row, column, or box that’s nearly full. If a row has one empty square and the only missing digit is 7, then 7 goes in that square.',
      'When there are several empty squares, check each square’s row, column, and box to rule out digits already present. Keep looking for squares with only one possible digit.',
    ],
  },
  {
    title: 'Use the controls',
    paragraphs: [
      'Select an empty square, then tap a number to enter it. Press and hold a number to keep it selected while you fill multiple squares.',
      'Turn on Notes to pencil in possible digits. Auto notes fills candidates based on the numbers already on the board. You can enable automatic note deletion in Sudoku settings.',
      'Hint first suggests a solving technique, then highlights the relevant squares on the second press. Press it a third time to reveal what to enter or which candidate to remove. Some packs limit which aids you can use.',
    ],
  },
]

export const games = [{
  ...sudoku, url: '/games/sudoku', theme: 'sudoku-theme',
  Preview: SudokuPreview, player: () => import('./Player.js'), guide: sudokuGuide,
}] as const
