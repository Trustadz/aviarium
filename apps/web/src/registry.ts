import { sudoku } from '../../../packages/sudoku/src/metadata.js'

import type { GuideSection } from './GameGuide.js'
import { NonogramsPreview } from './NonogramsPreview.js'
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
}, {
  id: 'nonograms', title: 'Nonograms', description: 'Use row and column clues to reveal a picture.',
  tags: ['Logic', 'Picross'], eReader: true, url: '/games/nonograms', theme: 'nonogram-theme',
  Preview: NonogramsPreview, player: () => import('./Nonograms.js'),
  guide: [
    {
      title: 'The goal',
      paragraphs: [
        'Each clue tells you the length of a group of filled squares. Read row clues left to right and column clues top to bottom.',
        'For a clue of 2 1, fill two squares together, leave at least one blank, then fill one more. A clue of 0 means the entire line is blank.',
      ],
    },
    {
      title: 'Use the controls',
      paragraphs: [
        'Choose Fill, Mark blank, or Erase, then tap a square. Marks help you keep track of blanks. The puzzle is solved when the filled squares match every clue.',
        'Drag across the grid to apply a tool to several squares. Starting on a square that already has that mark clears the whole stroke. Undo reverses one stroke.',
        'With a keyboard, use the arrow keys to move between squares, Space to use the selected tool, and X to mark a blank.',
      ],
    },
  ],
}] as const
