/**
 * Versioned deterministic randomness for 2048. This is deliberately small and
 * synchronous: the server validates a move log during a normal request, and the
 * browser generates the same start and spawn sequence offline.
 *
 * Never change the algorithm without bumping the generator version. A seed code
 * carries the version so an old code keeps reproducing its old board.
 */
export const twenty48GeneratorVersion = 1

function hash(value: string) {
  let state = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index)
    state = Math.imul(state, 0x01000193)
  }
  return state >>> 0
}

/** Mulberry32. Stable across engines because every step is 32-bit integer math. */
export function createRandom(seed: string, version = twenty48GeneratorVersion) {
  let state = hash(version + '|' + seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function seedHash(seed: string, version = twenty48GeneratorVersion) {
  return hash(version + '|' + seed).toString(16).padStart(8, '0')
}
