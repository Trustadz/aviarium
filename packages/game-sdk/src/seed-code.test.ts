import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSeedCode, parseSeedCode, type SeedPayload } from './seed-code.js'

const payload: SeedPayload = {
  game: 'sudoku',
  version: 2,
  seed: 'budge-2026',
  board: { difficulty: 'Medium' },
  options: { hints: true, autoNotes: false, timer: true },
}

test('seed codes round-trip board settings and played options', () => {
  const code = formatSeedCode(payload)
  assert.match(code, /^AVS1\./)
  assert.deepEqual(parseSeedCode(code, 'sudoku', 2), { ok: true, value: payload })
})

test('seed codes reject malformed, wrong-game and unsupported-version input', () => {
  assert.deepEqual(parseSeedCode('nonsense'), { ok: false, error: 'malformed' })
  assert.deepEqual(parseSeedCode('AVS1.not-base64!'), { ok: false, error: 'malformed' })
  assert.deepEqual(parseSeedCode(formatSeedCode(payload), 'nonograms', 2), { ok: false, error: 'wrong-game' })
  assert.deepEqual(parseSeedCode(formatSeedCode(payload), 'sudoku', 1), { ok: false, error: 'unsupported-version' })
})

test('seed codes reject unsafe values', () => {
  const code = formatSeedCode({ ...payload, board: { difficulty: 'x'.repeat(201) } as never })
  assert.deepEqual(parseSeedCode(code, 'sudoku', 2), { ok: false, error: 'malformed' })
})
