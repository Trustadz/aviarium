import type { Difficulty } from '../../game-sdk/src/index.js'

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
