import type { Difficulty, PublishedLevel } from '../../game-sdk/src/index.js'
import type { QuickPlayDescriptor } from './contracts.js'

export async function quickPlayId({ seed, difficulty, version }: QuickPlayDescriptor) {
  const input = new TextEncoder().encode(JSON.stringify([version, difficulty, seed]))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const prefix = Array.from(hash.subarray(0, 18), byte => byte.toString(16).padStart(2, '0')).join('')
  return 'quick-' + prefix
}

export function quickPlayLevel(id: string, grid: string, { seed, difficulty, version }: QuickPlayDescriptor): PublishedLevel {
  return { id, revision: 1, ruleset: 1, title: 'Quick Play', grid, difficulty, source: 'Generated', seed,
    generatorVersion: version }
}

const codes = { E: 'Easy', M: 'Medium', H: 'Hard', X: 'Extreme', G: 'Genius' } as const satisfies Record<string, Difficulty>

export function formatSeedCode(seed: string, difficulty: Difficulty, version: number) {
  const code = Object.entries(codes).find(([, value]) => value === difficulty)?.[0]
  return `AV${version}-${code}-${seed}`
}

export function parseSeedCode(text: string) {
  const match = /^AV([1-9]\d{0,8})-([EMHXG])-([\s\S]{1,100})$/.exec(text.trim())
  if (!match) return
  return { version: Number(match[1]), difficulty: codes[match[2] as keyof typeof codes], seed: match[3] }
}
