import type { Difficulty } from '../../../packages/game-sdk/src/index.js'
import { quickPlayDescriptorSchema, quickPlayVersion } from '../../../packages/sudoku/src/contracts.js'
import { quickPlayId, quickPlayLevel } from '../../../packages/sudoku/src/seed-code.js'
import workerUrl from './quick-play-worker.ts?worker&url'

export async function createQuickPlayLevel(difficulty: Difficulty, seed?: string, version?: number) {
  if (version !== undefined && version !== quickPlayVersion) throw new Error('This Quick Play seed uses an unsupported version.')
  const randomSeed = () => Array.from(crypto.getRandomValues(new Uint8Array(8)),
    byte => byte.toString(16).padStart(2, '0')).join('')
  const descriptor = quickPlayDescriptorSchema.parse({ difficulty, seed: seed ?? randomSeed(), version: quickPlayVersion })
  const id = await quickPlayId(descriptor)
  const worker = new Worker(workerUrl)
  try {
    const grid = await new Promise<string>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<string>) => resolve(event.data)
      worker.onerror = worker.onmessageerror = () => reject(new Error('Could not prepare a Quick Play puzzle.'))
      worker.postMessage(descriptor)
    })
    return quickPlayLevel(id, grid, descriptor)
  } finally {
    worker.terminate()
  }
}
