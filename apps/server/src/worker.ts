import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { pool } from './config.js'

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true })

async function processPuzzle() {
  await pool.query(`UPDATE puzzle_jobs SET status='failed',result='{"error":"Worker stopped before completing the job."}'
    WHERE status='running' AND lease_until<now() AND attempts>=3`)
  const { rows: [job] } = await pool.query(`WITH next AS (SELECT id FROM puzzle_jobs WHERE status='queued'
    OR (status='running' AND lease_until<now() AND attempts<3) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE puzzle_jobs j SET status='running', attempts=attempts+1,lease_until=now()+interval '30 seconds'
    FROM next WHERE next.id=j.id RETURNING j.id,j.attempts,j.kind,j.input`)
  if (!job) return false
  let status = 'complete'
  let result: unknown
  const thread = new Worker(new URL('./puzzle-task.js', import.meta.url), {
    workerData: job, resourceLimits: { maxOldGenerationSizeMb: 80 },
  })
  try {
    result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker deadline exceeded')), 12_000)
      const clear = () => clearTimeout(timeout)
      thread.once('message', value => { clear(); resolve(value) })
      thread.once('error', error => { clear(); reject(error) })
      thread.once('exit', code => { clear(); reject(new Error('Worker exited: ' + code)) })
    })
  } catch (error) {
    console.error('Puzzle worker failed', job.id, error)
    if (job.kind === 'validate') result = { kind: 'inconclusive', reason: 'Worker could not finish the test.' }
    else { status = 'failed'; result = { error: 'The generator could not finish. Try another seed.' } }
  } finally {
    await thread.terminate()
  }
  await pool.query(`UPDATE puzzle_jobs SET status=$1,result=$2,lease_until=NULL
    WHERE id=$3 AND attempts=$4 AND status='running'`, [status, result, job.id, job.attempts])
  return true
}

while (!stopping) {
  try { if (!await processPuzzle()) await delay(800) }
  catch (error) { console.error('Job polling failed', error); await delay(3000) }
}
await pool.end()
