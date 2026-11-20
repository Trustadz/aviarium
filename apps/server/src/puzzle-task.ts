import { parentPort, workerData } from 'node:worker_threads'
import { analyze, generate, validate } from '../../../packages/sudoku/src/solver.js'
import { generationSchema, gridSchema } from '../../../packages/sudoku/src/contracts.js'

if (workerData.kind === 'generate') {
  const options = generationSchema.parse(workerData.input)
  parentPort!.postMessage(generate(options.seed, options.difficulty, options.unique) ??
    { error: 'No puzzle matched the requested difficulty within the generation budget.' })
} else {
  const grid = Array.from(gridSchema.parse(workerData.input.grid), Number)
  const result = validate(grid)
  const analysis = (result.kind === 'unique' || result.kind === 'multiple') ? analyze(grid, result.solution) : undefined
  parentPort!.postMessage({ ...result, ...analysis })
}
