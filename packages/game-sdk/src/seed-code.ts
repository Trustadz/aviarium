/**
 * One versioned, URL-safe seed-sharing format for every Aviarium game.
 *
 * The payload is deliberately game-agnostic: the platform carries the game,
 * generator version, raw seed, board settings and played presentation options;
 * each game owns the meaning of `board` and validates it before generation.
 */
export const seedCodeVersion = 1
export const seedCodePrefix = 'AVS' + seedCodeVersion + '.'

export type SeedValue = boolean | number | string
export type SeedBoard = Record<string, SeedValue>
export type SeedOptions = Record<string, boolean>

export interface SeedPayload {
  game: string
  version: number
  seed: string
  board: SeedBoard
  options: SeedOptions
}

export type SeedError = 'malformed' | 'unsupported-version' | 'wrong-game' | 'invalid-options'

export type SeedParseResult =
  | { ok: true; value: SeedPayload }
  | { ok: false; error: SeedError }

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

function isValue(value: unknown): value is SeedValue {
  return typeof value === 'boolean' || typeof value === 'number' ||
    (typeof value === 'string' && value.length <= 200)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readBoard(value: unknown): SeedBoard | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 24) return undefined
  if (!entries.every(([key, item]) => /^[A-Za-z0-9_-]{1,40}$/.test(key) && isValue(item))) return undefined
  return Object.fromEntries(entries) as SeedBoard
}

function readOptions(value: unknown): SeedOptions | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 24) return undefined
  if (!entries.every(([key, item]) => /^[A-Za-z0-9_-]{1,40}$/.test(key) && typeof item === 'boolean')) return undefined
  return Object.fromEntries(entries) as SeedOptions
}

export function formatSeedCode(payload: SeedPayload) {
  const ordered: SeedPayload = {
    game: payload.game,
    version: payload.version,
    seed: payload.seed,
    board: Object.fromEntries(Object.entries(payload.board).sort(([left], [right]) => left.localeCompare(right))),
    options: Object.fromEntries(Object.entries(payload.options).sort(([left], [right]) => left.localeCompare(right))),
  }
  return seedCodePrefix + toBase64Url(JSON.stringify(ordered))
}

export function parseSeedCode(input: string, expectedGame?: string, expectedVersion?: number): SeedParseResult {
  const text = input.trim()
  if (!text.startsWith(seedCodePrefix)) return { ok: false, error: 'malformed' }
  let decoded: unknown
  try {
    decoded = JSON.parse(fromBase64Url(text.slice(seedCodePrefix.length)))
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (!isRecord(decoded)) return { ok: false, error: 'malformed' }
  const { game: g, version: v, seed: s, board: b, options: o } = decoded
  if (typeof g !== 'string' || g.length < 1 || g.length > 64 ||
      !Number.isInteger(v) || (v as number) < 1 || (v as number) > 10_000 ||
      typeof s !== 'string' || s.length < 1 || s.length > 200)
    return { ok: false, error: 'malformed' }
  if (expectedGame !== undefined && g !== expectedGame) return { ok: false, error: 'wrong-game' }
  const board = readBoard(b)
  const options = readOptions(o)
  if (!board || !options) return { ok: false, error: 'malformed' }
  if (expectedVersion !== undefined && (v as number) !== expectedVersion)
    return { ok: false, error: 'unsupported-version' }
  return { ok: true, value: { game: g, version: v as number, seed: s, board, options } }
}
