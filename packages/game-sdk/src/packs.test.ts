import assert from 'node:assert/strict'
import test from 'node:test'
import { assignPackLevels, chapterProgress, packProgress, packProgressPath, packStopAt, upgradePackDocument,
  type PackChapter, type PackEntry, type PackRevision } from './packs.js'

const rules = (inOrder: boolean) => ({ inOrder })
const entry = (id: string, title = id): PackEntry => ({ title, ruleset: 1, levelId: id, levelRevision: 1 })
const chapter = (id: string, inOrder: boolean, puzzles: PackEntry[]): PackChapter => ({
  id, title: id, description: '', theme: 'default', rules: rules(inOrder), puzzles,
})
const pack = (revision: number, chapters: PackChapter[], history?: PackRevision['history']): PackRevision => ({
  id: 'pack-1', revision, builtIn: false, data: { format: 2, game: 'fixture', title: 'Pack', description: '', chapters }, history,
})

test('chapters unlock in order and keep ordered access within their own trail', () => {
  const current = pack(1, [chapter('one', true, [entry('a1'), entry('a2')]),
    chapter('two', true, [entry('b1'), entry('b2')])])
  const empty = packProgress(current, [])
  assert.deepEqual(empty.solved, [false, false, false, false])
  assert.deepEqual(empty.playable, [true, false, false, false])
  assert.equal(empty.next, 0)
  assert.deepEqual(chapterProgress(current, [], 'two'), {
    id: 'two', title: 'two', solved: [false, false], playable: [false, false], next: 0,
    completed: 0, total: 2, complete: false, unlocked: false,
  })
  const completions = [
    { level: 'a1', revision: 1, packRevision: 1 },
    { level: 'a2', revision: 1, packRevision: 1 },
  ]
  assert.equal(chapterProgress(current, completions, 'one').complete, true)
  assert.deepEqual(chapterProgress(current, completions, 'two'), {
    id: 'two', title: 'two', solved: [false, false], playable: [true, false], next: 0,
    completed: 0, total: 2, complete: false, unlocked: true,
  })
  assert.equal(packStopAt(current, 3)?.chapter.id, 'two')
  assert.equal(packStopAt(current, 3)?.chapterStop, 1)
})

test('level identity survives chapter moves when the effective rules stay the same', () => {
  const previous = pack(1, [chapter('one', true, [entry('a'), entry('b')]), chapter('two', true, [entry('c')])])
  const next = pack(2, [chapter('one', true, [entry('a'), entry('c')])])
  const same = (value: PackEntry, nextRules: { inOrder: boolean }, prior: PackEntry, priorRules: { inOrder: boolean }) =>
    value.title === prior.title && nextRules.inOrder === priorRules.inOrder
  const chapters = assignPackLevels(next, previous, same)
  assert.ok(chapters)
  assert.deepEqual(chapters[0].puzzles.map(puzzle => [puzzle.levelId, puzzle.levelRevision]),
    [['a', 1], ['c', 1]])
})

test('moving a level into a chapter with different rules starts a new revision', () => {
  const previous = pack(1, [chapter('two', false, [entry('c')])])
  const next = pack(2, [chapter('one', true, [entry('c')])])
  const same = (value: PackEntry, nextRules: { inOrder: boolean }, prior: PackEntry, priorRules: { inOrder: boolean }) =>
    value.title === prior.title && nextRules.inOrder === priorRules.inOrder
  const chapters = assignPackLevels(next, previous, same)
  assert.ok(chapters)
  assert.deepEqual(chapters[0].puzzles.map(puzzle => [puzzle.levelId, puzzle.levelRevision]), [['c', 2]])
})

test('new levels receive chapter-scoped fallback identities', () => {
  const current = pack(3, [chapter('one', true, [{ title: 'First', ruleset: 1 }]),
    chapter('two', false, [{ title: 'Second', ruleset: 1 }])])
  assert.deepEqual(packProgressPath(current).stops.map(stop => [stop.id, stop.chapter, stop.chapterStop]),
    [['pack:pack-1:one:1', 'one', 1], ['pack:pack-1:two:1', 'two', 1]])
})

test('a format 1 document upgrades to one chapter', () => {
  const upgraded = upgradePackDocument({
    format: 1, game: 'fixture', title: 'Old', description: 'Before chapters.', theme: 'meadow',
    rules: { inOrder: true }, cover: 'data:image/png;base64,AA', background: 'data:image/png;base64,BB',
    puzzles: [{ title: 'First', ruleset: 1 }],
  }) as PackRevision['data']
  assert.equal(upgraded.format, 2)
  assert.equal(upgraded.chapters.length, 1)
  assert.equal(upgraded.chapters[0].id, 'chapter-1')
  assert.equal(upgraded.chapters[0].cover, 'data:image/png;base64,AA')
  assert.equal(upgraded.chapters[0].background, 'data:image/png;base64,BB')
  assert.equal(upgraded.chapters[0].puzzles[0].title, 'First')
})
