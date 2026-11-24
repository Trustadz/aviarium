import type { GameLevel } from '../../game-sdk/src/index.js'
import type { LeaderboardBoardKey } from '../../game-sdk/src/leaderboards.js'
import { randomDifficulties, randomSizes, type Puzzle } from './puzzles.js'

/**
 * Random Nonograms are grouped by grid size and difficulty. The seed stays on
 * the result so another player can reopen the exact clue grid.
 */
export const nonogramLeaderboardRulesVersion = 1
export const nonogramQuickBoards = randomSizes.flatMap(size => randomDifficulties.map(difficulty => ({
  key: 'quick:' + size + ':' + difficulty,
  kind: 'quick' as const,
  meta: { size, difficulty },
})))

type BoardLevel = Pick<GameLevel, 'id' | 'revision' | 'source'> & {
  difficulty?: string | null
  content?: Puzzle | null
}

export function nonogramBoardKey(level: BoardLevel): LeaderboardBoardKey {
  const difficulty = randomDifficulties.find(value => value === level.difficulty)
  const size = level.content?.rows.length
  const knownSize = size ? randomSizes.find(value => value === size) : undefined
  if (level.source === 'Generated' && knownSize && difficulty)
    return { key: 'quick:' + knownSize + ':' + difficulty, kind: 'quick', meta: { size: knownSize, difficulty } }
  return { key: 'level:' + level.id + ':' + level.revision, kind: 'level', meta: {},
    levelId: level.id, levelRevision: level.revision }
}

export function parseNonogramBoard(key: string): LeaderboardBoardKey | undefined {
  if (key.startsWith('quick:')) {
    const parts = key.split(':')
    if (parts.length !== 3) return undefined
    const size = randomSizes.find(value => String(value) === parts[1])
    const difficulty = randomDifficulties.find(value => value === parts[2])
    if (!size || !difficulty) return undefined
    return { key, kind: 'quick', meta: { size, difficulty } }
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

/** Canonical row and column clues for the per-puzzle cooldown. */
export function nonogramPuzzleContent(content: Puzzle) {
  return content.rows.map(row => row.join(',')).join(';') + '|' +
    content.columns.map(column => column.join(',')).join(';')
}
