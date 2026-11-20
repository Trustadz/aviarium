import { parentPort, workerData } from 'node:worker_threads'
import { validate } from '../../../packages/sudoku/src/solver.js'
import { generationSchema, gridSchema } from '../../../packages/sudoku/src/contracts.js'
import { gradePuzzle } from '../../../packages/sudoku/src/logic.js'
import { generateQuickPuzzle, quickPlayVersion } from '../../../packages/sudoku/src/quick-play.js'

if (workerData.kind === 'generate') {
  const options = generationSchema.parse(workerData.input)
  parentPort!.postMessage({ grid: generateQuickPuzzle(options.seed, options.difficulty), difficulty: options.difficulty,
    seed: options.seed, generatorVersion: quickPlayVersion, validation: 'unique' })
} else {
  const grid = Array.from(gridSchema.parse(workerData.input.grid), Number)
  const result = validate(grid)
  const analysis = (result.kind === 'unique' || result.kind === 'multiple') ? gradePuzzle(grid) : undefined
  parentPort!.postMessage({ ...result, ...analysis })
}
