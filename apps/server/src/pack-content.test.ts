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
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNg+M8AAAICAQB7CYGFJAAAAABJRU5ErkJggg=='
const base = builtInPacks[0].data

test('round-trips a chaptered pack with its artwork, ordered puzzles and challenge rules', () => {
  const data = readPackDraft({
    ...base,
    cover: png,
    chapters: [{ ...base.chapters[0], cover: png,
      rules: { hints: false, autoNotes: false, inOrder: true, lives: 3, timeTrial: true } }],
  })
  assert.deepEqual(importPack(exportPack(data)), data)
  assert.deepEqual(gradePack(data).chapters[0].puzzles.map(puzzle => puzzle.difficulty), ['Easy', 'Medium', 'Hard'])
})

test('round-trips a full multilingual pack and rejects oversized ZIP manifests', () => {
  const data = gradePack(readPackDraft({
    ...base, title: '題'.repeat(80), description: '文'.repeat(420),
    chapters: [{ ...base.chapters[0], title: '題'.repeat(80), description: '文'.repeat(420),
      puzzles: Array.from({ length: packLevelLimit }, () => ({
        ...base.chapters[0].puzzles[0], title: '題'.repeat(100), introduction: '話'.repeat(300),
      })) }],
  }))
  assert.ok(Buffer.byteLength(JSON.stringify(data)) > 32_768)
  assert.deepEqual(gradePack(importPack(exportPack(data))), data)
  const tooLarge = zipSync({ 'manifest.json': Buffer.alloc(maxPackManifestBytes + 1, ' ') })
  assert.throws(() => importPack(tooLarge), /valid Aviarium pack archive/)
})

test('round-trips artwork for every chapter', () => {
  const data = readPackDraft({
    ...base, cover: png,
    chapters: [
      { ...base.chapters[0], cover: png, background: png },
      { ...base.chapters[0], id: 'chapter-2', title: 'Second chapter', cover: png, background: png,
        puzzles: [base.chapters[0].puzzles[1]] },
    ],
  })
  const restored = importPack(exportPack(data))
  assert.deepEqual(restored, data)
  assert.equal(restored.chapters.length, 2)
  assert.equal(restored.chapters[1].cover, png)
  assert.equal(restored.chapters[1].background, png)
})

test('rejects incompatible archives and puzzles without a unique solution', () => {
  const data = base
  assert.throws(() => importPack(zipSync({ '../manifest.json': Buffer.from('{}') })), /valid Aviarium pack/)
  assert.throws(() => importPack(zipSync({ 'manifest.json': Buffer.from('{') })), /malformed/)
  assert.throws(() => gradePack({ ...data, chapters: [{ ...data.chapters[0],
    puzzles: [{ ...data.chapters[0].puzzles[0], grid: '0'.repeat(81) }] }] }), /unique solution/)
})

test('grades and exports a chapter with inherited and overridden diagonal rules', () => {
  const data = base
  const diagonal = Array.from('123456789456789123789123456935241867617538294842697531298314675371865942564972318',
    (digit, index) => index % 3 === 0 ? '0' : digit).join('')
  const draft = readPackDraft({
    ...data, chapters: [{ ...data.chapters[0], rules: { ...data.chapters[0].rules, diagonal: true },
      puzzles: [
        { title: 'Diagonal', grid: diagonal, ruleset: 1 },
        { ...data.chapters[0].puzzles[0], rules: { diagonal: false } },
      ] }],
  })
  const restored = importPack(exportPack(draft))
  assert.deepEqual(restored, draft)
  const pack = gradePack(restored)
  assert.deepEqual(pack.chapters[0].puzzles.map(puzzle => puzzle.ruleset), [2, 1])
  assert.throws(() => gradePack({ ...draft, chapters: [{ ...draft.chapters[0],
    puzzles: [{ ...draft.chapters[0].puzzles[0], grid: '0'.repeat(81) }] }] }), /unique solution/)
})

test('format 1 packs become one chapter without changing their level access', () => {
  const old = {
    format: 1, game: 'sudoku', title: 'Old pack', description: 'An older pack.', theme: 'meadow', cover: png,
    rules: { hints: true, autoNotes: true, inOrder: false, lives: null, timeTrial: false },
    puzzles: [{ ...base.chapters[0].puzzles[0], rules: { inOrder: false, hints: false, lives: null } }],
  }
  const upgraded = readPackDraft(old)
  assert.equal(upgraded.format, 2)
  assert.equal(upgraded.chapters.length, 1)
  assert.equal(upgraded.chapters[0].id, 'chapter-1')
  assert.equal(upgraded.chapters[0].title, 'Old pack')
  assert.equal(upgraded.chapters[0].cover, png)
  assert.deepEqual(upgraded.chapters[0].puzzles[0].rules, { hints: false, lives: null })
  assert.deepEqual(gradePack(old).chapters[0].puzzles[0].rules, { hints: false, lives: null })
  assert.equal(old.puzzles[0].rules.inOrder, false)
})

test('shared pack formats accept another game’s own content and rules', () => {
  const puzzle = z.object({ ...packLevelFields, letters: z.array(z.string()), rules: z.object({ guesses: z.number() }).partial().optional() })
  const schemas = definePackSchemas('words-fixture', z.literal('default'), progressionRules.extend({ guesses: z.number() }),
    puzzle, puzzle)
  const adapter: GamePacks = {
    readDraft: input => schemas.draft.parse(input), readManifest: input => schemas.manifest.parse(input),
    verify: input => schemas.published.parse(input), levels: () => [], sameLevel: () => true, builtIn: [],
  }
  const draft = readDraft(adapter, { format: 2, game: 'words-fixture', title: 'Words', description: '',
    chapters: [{ id: 'chapter-1', title: 'First words', description: '', theme: 'default',
      rules: { inOrder: true, guesses: 6 }, puzzles: [
        { title: 'First word', ruleset: 1, letters: ['H', 'E', 'L', 'L', 'O'], rules: { guesses: 5 } },
      ] }] })
  const copy = importArchive(adapter, exportArchive(adapter, draft))
  assert.deepEqual(copy, draft)
  assert.deepEqual(adapter.verify(copy, []).chapters[0].puzzles, draft.chapters[0].puzzles)
  assert.throws(() => importPack(exportArchive(adapter, draft)))
})
