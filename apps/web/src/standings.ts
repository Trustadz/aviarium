import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'

/**
 * Owner's after-game shape: top three always, plus the viewer's place with one
 * neighbour above/below; first place is just the top three, last place adds the
 * bottom three.
 */
export function resultRows(top: readonly LeaderboardStanding[], you: LeaderboardStanding | null,
  total: number): LeaderboardStanding[] {
  const rows = top.slice(0, 3)
  if (!you) return rows
  const add = (row: LeaderboardStanding) => {
    const index = rows.findIndex(item => item.rank === row.rank && item.name === row.name)
    if (index >= 0) rows[index] = row
    else rows.push(row)
  }
  if (you.rank <= 3) {
    add(you)
    return rows
  }
  if (you.rank === total) {
    for (const row of top.slice(-3)) add(row)
    add(you)
    return rows
  }
  for (const row of top.filter(row => Math.abs(row.rank - you.rank) <= 1)) add(row)
  add(you)
  return rows
}

/** Split the after-game rows into top-three and the viewer neighbourhood. */
export function resultGroups(top: readonly LeaderboardStanding[], you: LeaderboardStanding | null,
  total: number): LeaderboardStanding[][] {
  const rows = resultRows(top, you, total)
  if (rows.length <= 3 || !you) return [rows]
  return [rows.slice(0, 3), rows.slice(3)]
}
