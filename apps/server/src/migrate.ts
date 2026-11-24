import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { pool, transaction } from './config.js'
import { seedPacks } from './packs.js'
import { serverGames } from './games.js'

export async function migrate() {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(14016433)')
    await db.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
    const directory = new URL('../../../../apps/server/migrations/', import.meta.url)
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const existing = await db.query('SELECT 1 FROM migrations WHERE name=$1', [file])
      if (existing.rowCount) continue
      await db.query(await readFile(new URL(file, directory), 'utf8'))
      await db.query('INSERT INTO migrations(name) VALUES ($1)', [file])
      console.info('Applied migration', file)
    }
    for (const game of serverGames.values()) await seedPacks(db, game)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await migrate() } finally { await pool.end() }
}
