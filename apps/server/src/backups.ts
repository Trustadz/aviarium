import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { Cron } from 'croner'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from './auth.js'
import { pool } from './config.js'

export interface BackupConfig {
  folder: string; schedule: string; retention: number; requested_at: Date | null
  last_attempt: Date | null; last_success: Date | null; error: string | null
  archives: string[]; schedule_since: Date
}

const run = promisify(execFile)
const root = resolve(process.env.BACKUP_ROOT || '/backup')
const archivePattern = /^aviarium-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.dump$/
export const folderSchema = z.string().max(200).refine(value => !value || value.split('/').every(part =>
  /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]{0,63}$/.test(part)), 'Use a relative folder within /backup.')
export const scheduleSchema = z.string().trim().refine(value => {
  if (value.length > 100 || value.split(/\s+/).length !== 5 || !/^[\d*,/\-\s]+$/.test(value)) return false
  try { return Boolean(nextRun(value, new Date())) } catch { return false }
}, 'Enter a valid five-field UTC cron expression.')

export function nextRun(schedule: string, from: Date) {
  return new Cron(schedule, { utcOffset: 0 }).nextRun(from)
}

export function archiveNames(files: string[]) { return files.filter(name => archivePattern.test(name)).sort().reverse() }

async function destination(folder: string) {
  let current = root
  if (!(await lstat(current)).isDirectory()) throw new Error('Backup mount is not a directory.')
  for (const part of folderSchema.parse(folder).split('/').filter(Boolean)) {
    current = resolve(current, part)
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    if (!(await lstat(current)).isDirectory()) throw new Error('Backup subfolder must be a real directory.')
  }
  return current
}

export function registerBackups(app: FastifyInstance) {
  app.get('/api/admin/backup', async request => {
    await requireUser(request, 'admin')
    const { rows: [config] } = await pool.query<BackupConfig>('SELECT * FROM backup_config')
    return { ...config, next_run: nextRun(config.schedule, new Date()) }
  })
  app.put('/api/admin/backup', async request => {
    await requireUser(request, 'admin')
    const { folder, schedule, retention } = z.object({
      folder: folderSchema, schedule: scheduleSchema, retention: z.number().int().min(1).max(100),
    }).parse(request.body)
    await pool.query(`UPDATE backup_config SET archives=CASE WHEN folder=$1 THEN archives ELSE '[]' END,
      folder=$1,schedule=$2,retention=$3,schedule_since=CASE WHEN schedule=$2 THEN schedule_since ELSE now() END`,
    [folder, schedule, retention])
    return { saved: true }
  })
  app.post('/api/admin/backup', async request => {
    await requireUser(request, 'admin')
    await pool.query('UPDATE backup_config SET requested_at=now(),error=NULL')
    return { queued: true }
  })
}

export async function backupTick() {
  const connection = await pool.connect()
  try {
    const { rows: [lock] } = await connection.query('SELECT pg_try_advisory_lock(14016434) AS acquired')
    if (!lock.acquired) return
    try {
      const { rows: [config] } = await connection.query<BackupConfig>('SELECT * FROM backup_config')
      const from = config.last_attempt && config.last_attempt > config.schedule_since ? config.last_attempt : config.schedule_since
      const next = nextRun(config.schedule, from)
      if (!config.requested_at && (!next || next > new Date())) return
      await connection.query('UPDATE backup_config SET last_attempt=now(), requested_at=NULL,error=NULL')
      const directory = await destination(config.folder)
      const filename = 'aviarium-' + new Date().toISOString().replace(/[.:]/g, '-') + '-' + randomUUID() + '.dump'
      const path = resolve(directory, filename)
      const temporary = path + '.part'
      try {
        const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
        const env = {
          PATH: process.env.PATH, LC_ALL: 'C', PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT,
          PGUSER: process.env.PGUSER, PGDATABASE: process.env.PGDATABASE, PGPASSWORD: process.env.PGPASSWORD,
        }
        const connection: string[] = []
        if (database) {
          env.PGPASSWORD = database.searchParams.get('password') ?? decodeURIComponent(database.password)
          database.password = ''
          database.searchParams.delete('password')
          connection.push('--dbname', database.href)
        }
        await run('pg_dump', [...connection, '--format=custom', '--no-owner', '--no-acl',
          '--lock-wait-timeout=30s', '--file', temporary], { env, timeout: 15 * 60_000 })
        await run('pg_restore', ['--list', temporary], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true })
      }
      const names = archiveNames(await readdir(directory))
      for (const stale of names.slice(config.retention)) await rm(resolve(directory, stale), { force: true })
      await connection.query(`UPDATE backup_config SET last_success=now(), error=NULL,
        archives=CASE WHEN folder=$2 THEN $1 ELSE archives END`, [JSON.stringify(names.slice(0, config.retention)), config.folder])
      console.info(JSON.stringify({ event: 'backup_complete', archive: filename }))
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string }
      const message = failure.code === 'ENOSPC' || failure.stderr?.includes('No space') ? 'Backup disk is full.'
        : failure.code === 'EACCES' || failure.stderr?.includes('Permission denied') ? 'Backup folder is not writable.'
        : failure.code === 'ENOENT' ? 'Backup folder or PostgreSQL client tools are missing.'
        : 'Backup failed. Check the destination and PostgreSQL connection.'
      await connection.query('UPDATE backup_config SET error=$1', [message])
      console.error(JSON.stringify({ event: 'backup_failed', message }))
    } finally {
      await connection.query('SELECT pg_advisory_unlock(14016434)')
    }
  } finally {
    connection.release()
  }
}
