import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync } from 'fflate'
import { builtInPacks } from '../../../packages/sudoku/src/built-in-packs.js'
import { exportPack, gradePack, importPack, readPackDraft } from './pack-content.js'

test('round-trips a pack with its artwork, ordered puzzles and challenge rules', () => {
  const data = readPackDraft({
    ...builtInPacks[0].data,
    cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNg+M8AAAICAQB7CYGFJAAAAABJRU5ErkJggg==',
    rules: { hints: false, autoNotes: false, inOrder: true, lives: 3, timeTrial: true },
  })
  assert.deepEqual(importPack(exportPack(data)), data)
  assert.deepEqual(gradePack(data).puzzles.map(puzzle => puzzle.difficulty), ['Easy', 'Medium', 'Hard'])
})

test('rejects incompatible archives and puzzles without a unique solution', () => {
  const data = builtInPacks[0].data
  assert.throws(() => importPack(zipSync({ '../manifest.json': Buffer.from('{}') })), /valid Aviarium pack/)
  assert.throws(() => importPack(zipSync({ 'manifest.json': Buffer.from('{') })), /malformed/)
  assert.throws(() => gradePack({ ...data, puzzles: [{ ...data.puzzles[0], grid: '0'.repeat(81) }] }), /unique solution/)
})
