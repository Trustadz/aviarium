import { readdir, readFile } from 'node:fs/promises'
import { pool, transaction } from './config.js'
import { starterCatalog } from '../../../packages/sudoku/src/catalog.js'

try {
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
    for (const level of starterCatalog) {
      await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,validation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'unique') ON CONFLICT DO NOTHING`,
      [level.id, level.revision, level.ruleset, level.title, level.grid, level.difficulty, level.source])
    }
  })
} finally {
  await pool.end()
}
