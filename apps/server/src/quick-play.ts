import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import type { Pool } from 'pg'
import type { QuickPlayDescriptor } from '../../../packages/sudoku/src/contracts.js'
import { generateQuickPuzzle } from '../../../packages/sudoku/src/quick-play.js'
import { quickPlayLevel } from '../../../packages/sudoku/src/seed-code.js'

export async function getQuickPlayLevel(db: Pick<Pool, 'query'>, id: string, descriptor: QuickPlayDescriptor) {
  const fields = 'id,revision,ruleset,title,grid,difficulty,source,seed,generator_version AS "generatorVersion"'
  const { rows: [existing] } = await db.query<PublishedLevel>(`SELECT ${fields} FROM published_levels WHERE id=$1 AND revision=1 AND game_id='sudoku'`, [id])
  if (existing) return existing

  const { seed, difficulty, version } = descriptor
  const grid = generateQuickPuzzle(seed, difficulty)
  await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,seed,generator_version,
    validation,catalog_visible) VALUES($1,1,1,'Quick Play',$2,$3,'Generated',$4,$5,'unique',false) ON CONFLICT DO NOTHING`,
  [id, grid, difficulty, seed, version])
  return quickPlayLevel(id, grid, descriptor)
}
