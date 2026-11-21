import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import type { LogicalStep } from '../../../packages/sudoku/src/logic.js'
import type { PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { type Translate } from './i18n.js'
import type { Message } from './messages.js'

const builtInTitles: Readonly<Record<string, Message>> = {
  'first-light': 'First Light',
  'quiet-current': 'Quiet Current',
  afterglow: 'Afterglow',
  'pack:budgies:1': 'Garden Perch',
  'pack:budgies:2': 'Eucalyptus Grove',
  'pack:budgies:3': 'Flight at Dusk',
}

export function levelTitle(t: Translate, level: PublishedLevel) {
  const title = level.source === 'Built-in' && builtInTitles[level.id]
  if (title) return t(title)
  if (level.id.startsWith('quick-') && level.source === 'Generated') return t('Quick Play')
  return level.title
}

export function packTitle(t: Translate, pack: PublishedPack) {
  return pack.builtIn && pack.id === 'budgies' ? t('Budgies') : pack.data.title
}

export function packDescription(t: Translate, pack: PublishedPack) {
  return pack.builtIn && pack.id === 'budgies'
    ? t('Follow the flock from the garden perch to the treetops in three Sudoku puzzles.')
    : pack.data.description
}

const techniques: Partial<Record<LogicalStep['id'], Message>> = {
  'open-singles': 'Last empty cell', 'hidden-single': 'Hidden single', 'naked-single': 'Naked single',
  'pointing-elimination': 'Locked candidates', 'naked-pair': 'Naked Pair', 'x-wing': 'X-Wing',
  'hidden-pair': 'Hidden Pair', 'hidden-groups': 'Hidden Groups', 'naked-triple': 'Naked Triplet',
  'naked-quad': 'Naked Quadruple', swordfish: 'Swordfish', skyscraper: 'Skyscraper',
  'two-string-kite': 'Two-String-Kite', crane: 'Crane', 'y-wing': 'Y-Wing', 'w-wing': 'W-Wing',
  'xyz-wing': 'XYZ-Wing', 'simple-colouring': 'Simple Colouring', 'empty-rectangle': 'Empty Rectangle',
  'finned-x-wing': 'Finned X-Wing', 'wxyz-wing': 'WXYZ-Wing', 'finned-swordfish': 'Finned Swordfish',
  jellyfish: 'Jellyfish', 'finned-jellyfish': 'Finned Jellyfish', 'x-chain': 'X-Chain', 'xy-chain': 'XY-Chain',
  '3d-medusa': '3D-Medusa', aic: 'AIC',
}

export function technique(t: Translate, step: LogicalStep) {
  const message = techniques[step.id]
  return message ? t(message) : step.label
}
