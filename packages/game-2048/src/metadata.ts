import type { GameMetadata } from '../../game-sdk/src/index.js'

export const twenty48 = {
  id: '2048',
  title: '2048',
  description: 'Slide tiles, merge equal numbers, and reach 2048.',
  tags: ['Logic', 'Numbers', 'Sliding'],
  eReader: true,
  input: ['keyboard', 'pointer', 'touch'],
} as const satisfies GameMetadata
