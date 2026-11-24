import type { GameMetadata } from '../../game-sdk/src/index.js'

export const nonograms = {
  id: 'nonograms',
  title: 'Nonograms',
  description: 'Use row and column clues to reveal a picture.',
  tags: ['Logic', 'Picross'],
  eReader: true,
  input: ['keyboard', 'pointer', 'touch'],
} as const satisfies GameMetadata
