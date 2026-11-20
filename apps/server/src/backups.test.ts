import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveNames, folderSchema, nextRun, scheduleSchema } from './backups.js'

test('backup paths are relative to the mount and exclude traversal', () => {
  for (const good of ['', 'nas/aviarium', 'month 1/backups']) assert.ok(folderSchema.safeParse(good).success)
  for (const bad of ['/', '../secret', 'safe/../outside', '/root', 'a//b', 'a\\b']) assert.ok(!folderSchema.safeParse(bad).success)
})
test('cron settings are validated and use UTC', () => {
  assert.ok(scheduleSchema.safeParse('0 3 * * *').success)
  assert.ok(scheduleSchema.safeParse('*/20 2-5 * * 1,2').success)
  assert.ok(!scheduleSchema.safeParse('@reboot').success)
  assert.ok(!scheduleSchema.safeParse('61 2 * * *').success)
  assert.equal(nextRun('0 3 * * *', new Date('2026-03-29T02:00:00Z'))?.toISOString(), '2026-03-29T03:00:00.000Z')
})
test('rolling retention only recognizes completed Aviarium dumps', () => {
  const older = 'aviarium-2026-01-02T03-00-00-000Z-00000000-0000-4000-8000-000000000000.dump'
  const latest = older.replace('01-02', '01-03')
  assert.deepEqual(archiveNames(['other.dump', older, latest, latest + '.part']), [latest, older])
})
