import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { GamePacks } from './game-runtime.js'
import { zipSync } from 'fflate'
import { builtInPacks } from '../../../packages/sudoku/src/built-in-packs.js'
import { exportPack as exportArchive, importPack as importArchive, readPackDraft as readDraft } from './pack-content.js'
import { sudokuServer, verifySudokuPack as gradePack } from './sudoku-game.js'
import { definePackSchemas, maxPackManifestBytes, packLevelFields, packLevelLimit, progressionRules, type PackDocument } from '../../../packages/game-sdk/src/packs.js'

const exportPack = (data: PackDocument) => exportArchive(sudokuServer.packs, data)
const importPack = (bytes: Uint8Array) => importArchive(sudokuServer.packs, bytes)
const readPackDraft = (data: unknown) => readDraft(sudokuServer.packs, data)

test('round-trips a pack with its artwork, ordered puzzles and challenge rules', () => {
  const data = readPackDraft({
    ...builtInPacks[0].data,
    cover: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNg+M8AAAICAQB7CYGFJAAAAABJRU5ErkJggg==',
    rules: { hints: false, autoNotes: false, inOrder: true, lives: 3, timeTrial: true },
  })
  assert.deepEqual(importPack(exportPack(data)), data)
  assert.deepEqual(gradePack(data).puzzles.map(puzzle => puzzle.difficulty), ['Easy', 'Medium', 'Hard'])
})

test('round-trips a full multilingual pack and rejects oversized ZIP manifests', () => {
  const base = builtInPacks[0].data
  const data = gradePack(readPackDraft({
    ...base, title: '題'.repeat(80), description: '文'.repeat(420),
    puzzles: Array.from({ length: packLevelLimit }, () => ({
      ...base.puzzles[0], title: '題'.repeat(100), chapter: '章'.repeat(80), introduction: '話'.repeat(300),
    })),
  }))
  assert.ok(Buffer.byteLength(JSON.stringify(data)) > 32_768)
  assert.deepEqual(gradePack(importPack(exportPack(data))), data)
  const tooLarge = zipSync({ 'manifest.json': Buffer.alloc(maxPackManifestBytes + 1, ' ') })
  assert.throws(() => importPack(tooLarge), /valid Aviarium pack/)
})

test('rejects incompatible archives and puzzles without a unique solution', () => {
  const data = builtInPacks[0].data
  assert.throws(() => importPack(zipSync({ '../manifest.json': Buffer.from('{}') })), /valid Aviarium pack/)
  assert.throws(() => importPack(zipSync({ 'manifest.json': Buffer.from('{') })), /malformed/)
  assert.throws(() => gradePack({ ...data, puzzles: [{ ...data.puzzles[0], grid: '0'.repeat(81) }] }), /unique solution/)
})

test('grades and exports a pack with inherited and overridden diagonal rules', () => {
  const data = builtInPacks[0].data
  const diagonal = Array.from('123456789456789123789123456935241867617538294842697531298314675371865942564972318',
    (digit, index) => index % 3 === 0 ? '0' : digit).join('')
  const draft = readPackDraft({
    ...data, rules: { ...data.rules, diagonal: true },
    puzzles: [
      { title: 'Diagonal', grid: diagonal, ruleset: 1 },
      { ...data.puzzles[0], rules: { diagonal: false } },
    ],
  })
  const restored = importPack(exportPack(draft))
  assert.deepEqual(restored, draft)
  const pack = gradePack(restored)
  assert.deepEqual(pack.puzzles.map(puzzle => puzzle.ruleset), [2, 1])
  assert.throws(() => gradePack({ ...draft, puzzles: [data.puzzles[0]] }), /unique solution/)
})

test('new drafts use pack-only level access while old published data remains readable', () => {
  const data = builtInPacks[0].data
  const old = { ...data, puzzles: [{ ...data.puzzles[0], rules: { inOrder: false, hints: false, lives: null } }] }
  assert.deepEqual(readPackDraft(old).puzzles[0].rules, { hints: false, lives: null })
  assert.deepEqual(gradePack(old).puzzles[0].rules, { hints: false, lives: null })
  assert.equal(old.puzzles[0].rules.inOrder, false)
})

test('shared pack formats accept another game’s own content and rules', async () => {
  const puzzle = z.object({ ...packLevelFields, letters: z.array(z.string()), rules: z.object({ guesses: z.number() }).partial().optional() })
  const schemas = definePackSchemas('words-fixture', z.literal('default'), progressionRules.extend({ guesses: z.number() }),
    puzzle, puzzle)
  const adapter: GamePacks = {
    readDraft: input => schemas.draft.parse(input), readManifest: input => schemas.manifest.parse(input),
    verify: input => schemas.published.parse(input), levels: () => [], sameLevel: () => true, builtIn: [],
  }
  const draft = readDraft(adapter, { game: 'words-fixture', format: 1, title: 'Words', description: '', theme: 'default',
    rules: { inOrder: true, guesses: 6 }, puzzles: [
      { title: 'First word', ruleset: 1, letters: ['H', 'E', 'L', 'L', 'O'], rules: { guesses: 5 } },
    ] })
  const copy = importArchive(adapter, exportArchive(adapter, draft))
  assert.deepEqual(copy, draft)
  assert.deepEqual((await adapter.verify(copy, [])).puzzles, draft.puzzles)
  assert.throws(() => importPack(exportArchive(adapter, draft)))
})
