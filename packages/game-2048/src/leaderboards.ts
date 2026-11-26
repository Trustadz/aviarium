import type { GameLevel } from '../../game-sdk/src/index.js'
import type { LeaderboardBoardKey } from '../../game-sdk/src/leaderboards.js'
import { formatTwenty48SeedCode, quickPlayVersion, type Twenty48Level } from './contracts.js'

/** Scores are not times; the score board groups every Classic seed together. */
export const twenty48LeaderboardRulesVersion = 1
export const twenty48QuickBoards = [{
  key: 'quick:classic',
  kind: 'quick' as const,
  meta: { difficulty: 'Classic', size: 4 },
}]

type BoardLevel = Pick<GameLevel, 'id' | 'revision' | 'source'> & {
  difficulty?: string | null
  content?: { start?: number[] } | null
}

export function twenty48BoardKey(level: BoardLevel): LeaderboardBoardKey {
  if (level.source === 'Generated' || level.source === 'Challenge')
    return { key: 'quick:classic', kind: 'quick', meta: { difficulty: 'Classic', size: 4 } }
  return { key: 'level:' + level.id + ':' + level.revision, kind: 'level', meta: {},
    levelId: level.id, levelRevision: level.revision }
}

export function parseTwenty48Board(key: string): LeaderboardBoardKey | undefined {
  if (key === 'quick:classic')
    return { key, kind: 'quick', meta: { difficulty: 'Classic', size: 4 } }
  if (!key.startsWith('level:')) return undefined
  const rest = key.slice('level:'.length)
  const separator = rest.lastIndexOf(':')
  if (separator < 1) return undefined
  const levelId = rest.slice(0, separator)
  const levelRevision = Number(rest.slice(separator + 1))
  if (!/^[a-z0-9:-]{1,64}$/.test(levelId) || !Number.isInteger(levelRevision) || levelRevision < 1) return undefined
  return { key, kind: 'level', meta: {}, levelId, levelRevision }
}

/** Exact starting board + generator version, used for the 30-day cooldown. */
export function twenty48PuzzleContent(level: Twenty48Level | BoardLevel) {
  const seed = (level as Twenty48Level).seed
  const version = (level as Twenty48Level).generatorVersion ?? quickPlayVersion
  const start = (level.content?.start ?? []).join(',')
  return (seed ?? 'static') + '|' + version + '|' + start
}

export function twenty48SeedCode(level: Twenty48Level | BoardLevel) {
  const seed = (level as Twenty48Level).seed
  const version = (level as Twenty48Level).generatorVersion ?? quickPlayVersion
  return seed ? formatTwenty48SeedCode(seed, version) : undefined
}
