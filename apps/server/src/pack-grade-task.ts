import { parentPort, workerData } from 'node:worker_threads'
import { HttpError } from './auth.js'
import { createServerGames } from './games.js'

try {
  const game = createServerGames().get(workerData.game)
  if (!game) throw new HttpError(404, 'not_found')
  parentPort?.postMessage({ data: await game.packs.verify(workerData.draft, workerData.previouslyVerified) })
}
catch (error) {
  if (!(error instanceof HttpError)) throw error
  parentPort?.postMessage({ error: { status: error.statusCode, code: error.code, values: error.values } })
}
