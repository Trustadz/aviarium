import assert from 'node:assert/strict'
import test from 'node:test'
import { createIntl } from 'react-intl'
import type { Translate } from './i18n.js'
import { sudokuResultTags } from './sudoku-copy.js'

const intl = createIntl({ locale: 'en' })
const t = ((message, values) => intl.formatMessage({ id: message, defaultMessage: message }, values)) as Translate

test('a posted Sudoku result reports hints used without implying a rank', () => {
  assert.deepEqual(sudokuResultTags(t, { hintsUsed: 0, hints: true }), [{
    label: 'No hints', tone: 'praise', title: 'Solved without using hints.',
  }])
  assert.deepEqual(sudokuResultTags(t, { hintsUsed: 1, hints: true }), [{
    label: '1 hint', tone: 'muted', title: '1 hint used',
  }])
  assert.deepEqual(sudokuResultTags(t, { hintsUsed: 3, hints: true }), [{
    label: '3 hints', tone: 'muted', title: '3 hints used',
  }])
})

test('hints off and older results are not mislabelled as hint-free', () => {
  assert.deepEqual(sudokuResultTags(t, { hintsUsed: 0, hints: false }), [{
    label: 'Hints off', tone: 'praise', title: 'Hints were disabled for this run.',
  }])
  assert.equal(sudokuResultTags(t, { hints: true })[0]?.label, 'Not recorded')
  assert.equal(sudokuResultTags(t, undefined)[0]?.label, 'Not recorded')
  assert.equal(sudokuResultTags(t, { hintsUsed: -1, hints: true })[0]?.label, 'Not recorded')
  assert.equal(sudokuResultTags(t, { hintsUsed: 2.5, hints: true })[0]?.label, 'Not recorded')
})
