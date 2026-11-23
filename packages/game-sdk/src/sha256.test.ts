import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { sha256, sha256Fallback } from './sha256.js'

const digest = (value: string) => new Uint8Array(createHash('sha256').update(value).digest())

test('the SHA-256 fallback matches the platform digest', async () => {
  for (const value of ['', 'abc', 'Aviarium', '🦜 eucalyptus', 'x'.repeat(1000), 'x'.repeat(100_000)]) {
    const input = new TextEncoder().encode(value)
    assert.deepEqual(sha256Fallback(input), digest(value))
    assert.deepEqual(await sha256(input), digest(value))
  }
})
