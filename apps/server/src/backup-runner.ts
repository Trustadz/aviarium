import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { backupTick } from './backups.js'
import { pool } from './config.js'

export async function runBackups(signal: AbortSignal) {
  while (!signal.aborted) {
    try { await backupTick(signal) }
    catch { console.error(JSON.stringify({ event: 'backup_connection_failed' })) }
    await delay(5000, undefined, { signal }).catch(error => {
      if (!signal.aborted) throw error
    })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  const stop = new AbortController()
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop.abort())
  try { await runBackups(stop.signal) } finally { await pool.end() }
}
