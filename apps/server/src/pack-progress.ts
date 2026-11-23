import type { Pool } from 'pg'
import { packLevelId, type PackPath, type PackRevision } from '../../../packages/game-sdk/src/packs.js'

interface PathRow {
  id: string
  revision: number
  inOrder: boolean
  stops: { id?: string; revision?: number; inOrder?: boolean }[]
}

export async function packHistory(db: Pick<Pool, 'query'>, packs: readonly Pick<PackRevision, 'id' | 'revision'>[]) {
  if (!packs.length) return new Map<string, PackPath[]>()
  const targets = new Map(packs.map(pack => [pack.id, pack.revision]))
  const { rows } = await db.query<PathRow>(`SELECT r.pack_id AS id,r.revision,
    (r.data->'rules'->>'inOrder')::boolean AS "inOrder",
    (SELECT jsonb_agg(jsonb_build_object('id',puzzle->'levelId','revision',puzzle->'levelRevision',
      'inOrder',puzzle->'rules'->'inOrder') ORDER BY ordinal)
      FROM jsonb_array_elements(r.data->'puzzles') WITH ORDINALITY AS items(puzzle,ordinal)) AS stops
    FROM pack_revisions r JOIN unnest($1::text[], $2::int[]) AS target(id,rev)
      ON target.id=r.pack_id AND r.revision < target.rev ORDER BY r.pack_id,r.revision`,
  [[...targets.keys()], [...targets.values()]])
  const history = new Map<string, PackPath[]>()
  for (const row of rows) {
    const paths = history.get(row.id) ?? []
    paths.push({ revision: row.revision, stops: row.stops.map((stop, index) => ({
      id: stop.id ?? packLevelId(row.id, index + 1), revision: stop.revision ?? row.revision, inOrder: stop.inOrder ?? row.inOrder,
    })) })
    history.set(row.id, paths)
  }
  return history
}
