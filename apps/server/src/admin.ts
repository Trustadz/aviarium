import { pool } from './config.js'
const [issuer, subject] = process.argv.slice(2)
try {
  if (!issuer || !subject) throw new Error('Usage: node dist/apps/server/src/admin.js ISSUER SUBJECT')
  const result = await pool.query("UPDATE users SET role='admin' WHERE issuer=$1 AND subject=$2 RETURNING id", [issuer, subject])
  if (!result.rowCount) throw new Error('User must sign in with Pocket ID before assigning admin.')
  console.info('Assigned Aviarium admin:', result.rows[0].id)
} finally {
  await pool.end()
}
