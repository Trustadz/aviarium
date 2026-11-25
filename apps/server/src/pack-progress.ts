import type { Pool } from 'pg'
import { packLevelId, type PackPath, type PackRevision } from '../../../packages/game-sdk/src/packs.js'

interface PathRow {
  id: string
  revision: number
  inOrder: boolean
  stops: {
    id?: string
    revision?: number
    inOrder?: boolean
    chapter?: string
    chapterIndex?: number
    chapterStop?: number
  }[]
}

export async function packHistory(db: Pick<Pool, 'query'>, packs: readonly Pick<PackRevision, 'id' | 'revision'>[]) {
  if (!packs.length) return new Map<string, PackPath[]>()
  const targets = new Map(packs.map(pack => [pack.id, pack.revision]))
  const { rows } = await db.query<PathRow>(`SELECT r.pack_id AS id,r.revision,
    (r.data->'chapters'->0->'rules'->>'inOrder')::boolean AS "inOrder",
    (SELECT jsonb_agg(jsonb_build_object(
      'id',puzzle->'levelId','revision',puzzle->'levelRevision',
      'inOrder',COALESCE(puzzle->'rules'->'inOrder',chapter->'rules'->'inOrder'),
      'chapter',chapter->>'id','chapterIndex',chapter_ordinal - 1,'chapterStop',puzzle_ordinal
    ) ORDER BY chapter_ordinal, puzzle_ordinal)
      FROM jsonb_array_elements(r.data->'chapters') WITH ORDINALITY AS chapters(chapter, chapter_ordinal)
      CROSS JOIN LATERAL jsonb_array_elements(chapter->'puzzles') WITH ORDINALITY AS puzzles(puzzle, puzzle_ordinal)) AS stops
    FROM pack_revisions r JOIN unnest($1::text[], $2::int[]) AS target(id,rev)
      ON target.id=r.pack_id AND r.revision < target.rev ORDER BY r.pack_id,r.revision`,
  [[...targets.keys()], [...targets.values()]])
  const history = new Map<string, PackPath[]>()
  for (const row of rows) {
    const paths = history.get(row.id) ?? []
    let stop = 0
    paths.push({ revision: row.revision, stops: row.stops.map(item => {
      stop += 1
      const chapter = item.chapter ?? 'chapter-1'
      const chapterStop = item.chapterStop ?? stop
      return {
        id: item.id ?? packLevelId(row.id, chapter, chapterStop), revision: item.revision ?? row.revision,
        inOrder: item.inOrder ?? row.inOrder, chapter, chapterIndex: item.chapterIndex ?? 0, chapterStop, stop,
      }
    }) })
    history.set(row.id, paths)
  }
  return history
}
