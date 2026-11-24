import type { Difficulty, GameLevel } from '../../game-sdk/src/index.js'
import { difficulties } from '../../game-sdk/src/index.js'
import type { LeaderboardBoardKey } from '../../game-sdk/src/leaderboards.js'
import { formatSeedCode } from './seed-code.js'

/**
 * Quick Play is ranked per difficulty, not per seed. Every completed grid of a
 * difficulty shares that board; the exact seed is stored on the result so other
 * players can reopen the same grid.
 */
export const sudokuLeaderboardRulesVersion = 1
export const sudokuQuickBoards = difficulties.map(difficulty => ({
  key: 'quick:' + difficulty,
  kind: 'quick' as const,
  meta: { difficulty },
}))

type BoardLevel = Pick<GameLevel, 'id' | 'revision' | 'source'> & { difficulty?: string | null }

export function sudokuBoardKey(level: BoardLevel): LeaderboardBoardKey {
  const difficulty = difficulties.find(value => value === level.difficulty)
  if (level.source === 'Generated' && difficulty)
    return { key: 'quick:' + difficulty, kind: 'quick', meta: { difficulty } }
  return { key: 'level:' + level.id + ':' + level.revision, kind: 'level', meta: {},
    levelId: level.id, levelRevision: level.revision }
}

export function parseSudokuBoard(key: string): LeaderboardBoardKey | undefined {
  if (key.startsWith('quick:')) {
    const difficulty = difficulties.find(value => value === key.slice('quick:'.length))
    return difficulty ? { key, kind: 'quick', meta: { difficulty } } : undefined
  }
  if (!key.startsWith('level:')) return undefined
  const rest = key.slice('level:'.length)
  const separator = rest.lastIndexOf(':')
  if (separator < 1) return undefined
  const levelId = rest.slice(0, separator)
  const levelRevision = Number(rest.slice(separator + 1))
  if (!/^[a-z0-9:-]{1,64}$/.test(levelId) || !Number.isInteger(levelRevision) || levelRevision < 1) return undefined
  return { key, kind: 'level', meta: {}, levelId, levelRevision }
}

type PuzzleLevel = { grid?: string | null; ruleset: number }

/** The exact starting grid, including the diagonal ruleset, for the cooldown. */
export function sudokuPuzzleContent(level: PuzzleLevel) {
  return (level.grid ?? '') + '|' + level.ruleset
}

export function sudokuSeedCode(level: { seed?: string | null; difficulty?: string | null; generatorVersion?: number | null }) {
  const difficulty = difficulties.find(value => value === level.difficulty) as Difficulty | undefined
  return level.seed && difficulty && level.generatorVersion
    ? formatSeedCode(level.seed, difficulty, level.generatorVersion)
    : undefined
}
