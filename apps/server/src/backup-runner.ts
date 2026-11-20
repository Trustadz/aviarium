import { setTimeout as delay } from 'node:timers/promises'
import { backupTick } from './backups.js'
import { pool } from './config.js'

process.umask(0o077)
let stop = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stop = true })
while (!stop) {
  try { await backupTick() } catch { console.error(JSON.stringify({ event: 'backup_connection_failed' })) }
  if (!stop) await delay(5000)
}
await pool.end()
