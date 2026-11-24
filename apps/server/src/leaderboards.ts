import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import {
  emptyLeaderboardPlayerSummary, emptyLeaderboardSummary, leaderboardCooldownDays, leaderboardResultStatuses,
  leaderboardTopLimit,
  type LeaderboardBoardInfo, type LeaderboardBoardKey, type LeaderboardCooldown, type LeaderboardPackStanding,
  type LeaderboardPackSummary, type LeaderboardPlayerResult, type LeaderboardPlayerSummary, type LeaderboardRecords,
  type LeaderboardRemovalNotice, type LeaderboardStanding, type LeaderboardSummary, type LeaderboardValueUnit,
} from '../../../packages/game-sdk/src/leaderboards.js'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { AttemptMutation, SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
import { digest, HttpError, requireUser, type User } from './auth.js'
import { pool, testEnvironment, transaction } from './config.js'
import type { LevelRecord, ServerGame } from './game-runtime.js'
import { serverGames } from './games.js'

const levelFields = `l.id,l.revision,l.ruleset,l.title,l.grid,l.difficulty,l.source,l.pack,l.content,
  l.game_id AS game,l.seed,l.generator_version AS "generatorVersion"`
const summaryLimit = 3
const gameParam = z.string().regex(/^[a-z0-9-]{1,64}$/)
const resultId = (request: FastifyRequest) => z.uuid().parse((request.params as { id: string }).id)

interface SummaryRow {
  board_key: string
  owner_id: string
  score_value: string | number
  value_unit: string
  completed_at: Date | string
  id: string
  level_id: string
  level_revision: number
  seed_code: string | null
  aids: unknown
  rank: number
  total: number
  name: string
  recorded_at: Date | string
  avatar: string | null
}
type Summary = Omit<LeaderboardSummary, 'board'>
const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString()

function gameFor(id: string): ServerGame {
  const game = serverGames.get(gameParam.parse(id))
  if (!game?.leaderboards) throw new HttpError(404, 'leaderboard_game_not_found')
  return game
}

function boardInfo(game: ServerGame, board: LeaderboardBoardKey, level?: LevelRecord, packTitle?: string): LeaderboardBoardInfo {
  const meta = board.meta
  return {
    game: game.id, key: board.key, kind: board.kind,
    difficulty: typeof meta.difficulty === 'string' ? meta.difficulty : undefined,
    size: typeof meta.size === 'number' ? meta.size : undefined,
    levelId: board.levelId, levelRevision: board.levelRevision,
    levelTitle: level?.title, packTitle,
  }
}

function standing(row: SummaryRow, viewer: string, level?: LevelRecord): LeaderboardStanding {
  return {
    rank: row.rank, name: row.name, value: Number(row.score_value),
    unit: row.value_unit as LeaderboardValueUnit,
    completedAt: iso(row.completed_at), recordedAt: iso(row.recorded_at),
    you: row.owner_id === viewer,
    avatarUrl: row.avatar ? '/api/users/' + row.owner_id + '/avatar' : undefined,
    level, seedCode: row.seed_code, aids: row.aids,
  }
}

async function levelsForPairs(db: Pool | PoolClient, game: ServerGame, pairs: readonly (readonly [string, number])[]) {
  const unique = [...new Map(pairs.filter(([id, revision]) => id && revision > 0).map(pair => [pair[0] + ':' + pair[1], pair])).values()]
  if (!unique.length) return new Map<string, LevelRecord>()
  const placeholders = unique.map((_, index) => `($${index * 2 + 2},$${index * 2 + 3})`).join(',')
  const { rows } = await db.query<LevelRecord>(`SELECT ${levelFields} FROM published_levels l
    WHERE l.game_id=$1 AND (l.id,l.revision) IN (${placeholders})`,
  [game.id, ...unique.flatMap(pair => [pair[0], pair[1]])])
  return new Map(rows.map(level => [level.id + ':' + level.revision, level]))
}

async function boardSummaries(db: Pool | PoolClient, game: ServerGame, keys: readonly string[], viewer: string, limit: number) {
  const unique = [...new Set(keys)]
  if (!unique.length) return new Map<string, Summary>()
  const { rows } = await db.query<SummaryRow>(`WITH best AS (
      SELECT DISTINCT ON (board_key, owner_id) board_key, owner_id, score_value, value_unit, completed_at, id,
        recorded_at, level_id, level_revision, seed_code, aids, rank_value
      FROM leaderboard_results
      WHERE game_id=$1 AND status='active' AND board_key = ANY($2::text[])
      ORDER BY board_key, owner_id, rank_value, completed_at, id
    ), ranked AS (
      SELECT *, (rank() OVER (PARTITION BY board_key ORDER BY rank_value))::int AS rank,
        (count(*) OVER (PARTITION BY board_key))::int AS total
      FROM best
    )
    SELECT ranked.board_key, ranked.owner_id, ranked.score_value, ranked.value_unit, ranked.completed_at, ranked.id,
      ranked.recorded_at, ranked.level_id, ranked.level_revision, ranked.seed_code, ranked.aids, ranked.rank, ranked.total,
      COALESCE(u.display_name,u.name) AS name, COALESCE(u.custom_avatar,u.pocket_avatar) AS avatar
    FROM ranked JOIN users u ON u.id=ranked.owner_id
    WHERE ranked.rank <= $3 OR ranked.owner_id=$4
    ORDER BY ranked.board_key, ranked.rank, ranked.completed_at, ranked.id`, [game.id, unique, limit, viewer])
  const levels = await levelsForPairs(db, game, rows.map(row => [row.level_id, row.level_revision] as const))
  const grouped = new Map<string, SummaryRow[]>()
  for (const row of rows) {
    const items = grouped.get(row.board_key) ?? []
    items.push(row)
    grouped.set(row.board_key, items)
  }
  const result = new Map<string, Summary>()
  for (const [key, items] of grouped) {
    const standings = items.map(row => standing(row, viewer, levels.get(row.level_id + ':' + row.level_revision)))
    result.set(key, {
      top: standings.filter(item => item.rank <= limit),
      you: standings.find(item => item.you) ?? null,
      total: items[0].total,
    })
  }
  return result
}

interface PlayerRow {
  game_id: string
  board_key: string
  board_kind: string
  board_meta: unknown
  level_title: string
  pack_title: string | null
  seed_code: string | null
  score_value: string | number
  value_unit: string
  completed_at: Date | string
  recorded_at: Date | string
}
interface RankedPlayerRow extends PlayerRow { rank: number; total: number }

function boardFromPlayer(row: PlayerRow): LeaderboardBoardInfo {
  return boardFromResult({
    game: row.game_id, boardKey: row.board_key, boardKind: row.board_kind, boardMeta: row.board_meta,
    levelTitle: row.level_title, packTitle: row.pack_title,
  })
}

function playerResult(row: PlayerRow, rank: number, total: number): LeaderboardPlayerResult {
  return {
    game: row.game_id, board: boardFromPlayer(row), rank, total, value: Number(row.score_value),
    unit: row.value_unit as LeaderboardValueUnit,
    completedAt: iso(row.completed_at), recordedAt: iso(row.recorded_at),
  }
}

async function playerSummary(db: Pool | PoolClient, viewer: string, gameId?: string): Promise<LeaderboardPlayerSummary> {
  const scope = gameId ? 'AND game_id=$2' : ''
  const params = gameId ? [viewer, gameId] : [viewer]
  const { rows: [counts] } = await db.query<{ posted: number; boards: number }>(`SELECT
      count(*)::int AS posted, count(DISTINCT game_id || ':' || board_key)::int AS boards
    FROM leaderboard_results WHERE owner_id=$1 AND status='active' ${scope}`, params)
  const { rows: [latest] } = await db.query<PlayerRow>(`SELECT game_id, board_key, board_kind, board_meta,
      level_title, pack_title, seed_code, score_value, value_unit, completed_at, recorded_at
    FROM leaderboard_results WHERE owner_id=$1 AND status='active' ${scope}
    ORDER BY recorded_at DESC, id DESC LIMIT 1`, params)
  if (!latest) return { ...emptyLeaderboardPlayerSummary(), posted: counts?.posted ?? 0, boards: counts?.boards ?? 0 }
  const latestSummary = (await boardSummaries(db, gameFor(latest.game_id), [latest.board_key], viewer, 1)).get(latest.board_key)
  const lastPosted = playerResult(latest, latestSummary?.you?.rank ?? 0, latestSummary?.total ?? 0)
  const { rows: [best] } = await db.query<RankedPlayerRow>(`WITH best AS (
      SELECT DISTINCT ON (game_id, board_key, owner_id) game_id, board_key, owner_id, board_kind, board_meta,
        level_title, pack_title, seed_code, score_value, value_unit, completed_at, recorded_at, rank_value
      FROM leaderboard_results WHERE status='active' ${gameId ? 'AND game_id=$2' : ''}
      ORDER BY game_id, board_key, owner_id, rank_value, completed_at, id
    ), ranked AS (
      SELECT *, rank() OVER (PARTITION BY game_id, board_key ORDER BY rank_value)::int AS rank,
        count(*) OVER (PARTITION BY game_id, board_key)::int AS total
      FROM best
    )
    SELECT * FROM ranked WHERE owner_id=$1
    ORDER BY rank ASC, total DESC, recorded_at DESC LIMIT 1`, params)
  return {
    lastPosted, bestRank: best ? playerResult(best, best.rank, best.total) : null,
    posted: counts?.posted ?? 0, boards: counts?.boards ?? 0,
  }
}

interface PackRow {
  owner_id: string
  total: string | number
  levels: number
  recorded_at: Date | string
  name: string
  avatar: string | null
  pack_rank: number | null
}

async function packSummary(db: Pool | PoolClient, game: ServerGame, pack: PackRevision,
  viewer: string): Promise<LeaderboardPackSummary> {
  const levels = game.packs!.levels(pack)
  const keys = levels.map(level => game.leaderboards!.boardKey(level).key)
  const { rows } = await db.query<PackRow>(`WITH best AS (
      SELECT DISTINCT ON (board_key, owner_id) board_key, owner_id, score_value, completed_at, recorded_at, id, rank_value
      FROM leaderboard_results
      WHERE status='active' AND game_id=$1 AND board_key = ANY($2::text[])
      ORDER BY board_key, owner_id, rank_value, completed_at, id
    ), totals AS (
      SELECT owner_id, sum(score_value)::bigint AS total, count(DISTINCT board_key)::int AS levels,
        max(recorded_at) AS recorded_at
      FROM best GROUP BY owner_id
    ), ranked AS (
      SELECT totals.*, COALESCE(u.display_name,u.name) AS name,
        COALESCE(u.custom_avatar,u.pocket_avatar) AS avatar,
        CASE WHEN totals.levels = $3
          THEN rank() OVER (PARTITION BY (totals.levels = $3) ORDER BY total)::int END AS pack_rank,
        count(*) FILTER (WHERE totals.levels = $3) OVER ()::int AS players
      FROM totals JOIN users u ON u.id=totals.owner_id
    ) SELECT * FROM ranked
    ORDER BY (levels = $3) DESC, pack_rank NULLS LAST, total, recorded_at, owner_id`,
  [game.id, keys, keys.length])
  const complete = rows.filter(row => row.levels === keys.length)
  const me = rows.find(row => row.owner_id === viewer)
  const standing = (row: PackRow): LeaderboardPackStanding => ({
    rank: row.pack_rank, name: row.name, total: Number(row.total), levels: row.levels, you: row.owner_id === viewer,
    avatarUrl: row.avatar ? '/api/users/' + row.owner_id + '/avatar' : undefined,
  })
  return {
    id: pack.id, revision: pack.revision, title: pack.data.title, builtIn: pack.builtIn,
    levels: keys.length, players: complete.length,
    top: complete.slice(0, 10).map(standing), you: me ? standing(me) : null,
  }
}

async function levelForBoard(db: Pool | PoolClient, game: ServerGame, board: LeaderboardBoardKey) {
  if (board.kind !== 'level' || !board.levelId || !board.levelRevision) return
  const { rows: [level] } = await db.query<LevelRecord>(`SELECT ${levelFields} FROM published_levels l
    WHERE l.id=$1 AND l.revision=$2 AND l.game_id=$3`, [board.levelId, board.levelRevision, game.id])
  return level
}

async function packTitleFor(db: Pool | PoolClient, level?: LevelRecord) {
  if (!level?.pack) return
  const { rows: [pack] } = await db.query<{ title: string | null }>(
    `SELECT data->>'title' AS title FROM pack_revisions WHERE pack_id=$1 AND revision=$2`,
    [level.pack.id, level.pack.revision])
  return pack?.title ?? undefined
}

async function visiblePacks(db: Pool | PoolClient, game: ServerGame) {
  return (await db.query<PackRevision>(`SELECT p.id,r.revision,p.owner_id IS NULL AS "builtIn",r.data
    FROM packs p JOIN pack_revisions r ON r.pack_id=p.id AND r.revision=p.published_revision
    WHERE p.game_id=$1 AND p.visible AND p.deleted_at IS NULL
    ORDER BY p.owner_id IS NOT NULL,r.data->>'title',p.id`, [game.id])).rows
}

async function standaloneLevels(db: Pool | PoolClient, game: ServerGame) {
  return (await db.query<LevelRecord>(`SELECT ${levelFields} FROM published_levels l
    WHERE l.game_id=$1 AND l.catalog_visible AND l.pack IS NULL
      AND NOT EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=l.id)
    ORDER BY l.title,l.id`, [game.id])).rows
}

/**
 * Called inside the existing progress transaction when a completed attempt is
 * accepted. Every completion is stored; a second completion of the same exact
 * puzzle inside the cooldown is stored as `cooldown` and hidden from standings.
 */
export async function recordLeaderboardResult(db: PoolClient, user: User, game: ServerGame, level: LevelRecord,
  mutation: AttemptMutation, saved: SavedAttempt, pack?: PackRevision) {
  const leaderboards = game.leaderboards
  if (!leaderboards) return
  const record = leaderboards.record(level, mutation.data, pack?.data.title)
  const puzzleKey = digest(game.id + '|' + record.puzzleContent)
  const recent = await db.query(`SELECT 1 FROM leaderboard_results
    WHERE owner_id=$1 AND game_id=$2 AND puzzle_key=$3
      AND recorded_at > now() - make_interval(days => $4) LIMIT 1`,
  [user.id, game.id, puzzleKey, leaderboardCooldownDays])
  const now = Date.now()
  const reported = Number(mutation.data.completedAt ?? now)
  const completedAt = new Date(Number.isFinite(reported) && reported > 0 ? Math.min(reported, now) : now)
  const recordedAt = testEnvironment && mutation.seedRecordedAt
    ? new Date(Math.min(mutation.seedRecordedAt, now)) : null
  await db.query(`INSERT INTO leaderboard_results(save_id,owner_id,game_id,board_key,board_kind,board_meta,
    level_id,level_revision,pack_id,pack_revision,pack_stop,level_title,pack_title,seed_code,puzzle_key,
    score_value,value_unit,lower_is_better,aids,rules_version,completed_at,recorded_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,COALESCE($22::timestamptz,now()),$23)
    ON CONFLICT (save_id) DO NOTHING`,
  [saved.id, user.id, game.id, record.boardKey, record.boardKind, JSON.stringify(record.boardMeta),
    level.id, level.revision, level.pack?.id ?? null, level.pack?.revision ?? null, level.pack?.stop ?? null,
    level.title, record.packTitle ?? null, record.seedCode ?? null, puzzleKey,
    record.value, record.unit, record.lowerIsBetter,
    record.aids === undefined || record.aids === null ? null : JSON.stringify(record.aids),
    record.rulesVersion, completedAt, recordedAt, recent.rowCount ? 'cooldown' : 'active'])
}

function boardFromResult(row: { game: string; boardKey: string; boardKind: string; boardMeta: unknown;
  levelTitle: string; packTitle: string | null }): LeaderboardBoardInfo {
  return {
    game: row.game, key: row.boardKey, kind: row.boardKind as 'quick' | 'level',
    ...(row.boardMeta && typeof row.boardMeta === 'object' ? row.boardMeta as Record<string, string | number> : {}),
    levelTitle: row.levelTitle, packTitle: row.packTitle ?? undefined,
  }
}

export function registerLeaderboards(app: FastifyInstance) {
  app.get('/api/leaderboards', async request => {
    const user = await requireUser(request)
    const entries = await Promise.all([...serverGames.values()].filter(game => game.leaderboards).map(async game => {
      const { rows: [busiest] } = await pool.query<{ board_key: string }>(`SELECT board_key FROM leaderboard_results
        WHERE game_id=$1 AND status='active' GROUP BY board_key ORDER BY count(*) DESC, board_key LIMIT 1`, [game.id])
      const board = (busiest && game.leaderboards!.parseBoard(busiest.board_key)) || game.leaderboards!.quickBoards[0]!
      const level = board.kind === 'level' ? await levelForBoard(pool, game, board) : undefined
      const info = boardInfo(game, board, level, level ? await packTitleFor(pool, level) : undefined)
      const summary = (await boardSummaries(pool, game, [board.key], user.id, summaryLimit)).get(board.key)
      const player = await playerSummary(pool, user.id, game.id)
      return { game: game.id, board: info, ...(summary ?? emptyLeaderboardSummary(info)), player }
    }))
    return { games: entries, player: await playerSummary(pool, user.id) }
  })

  app.get('/api/leaderboards/games/:game', async request => {
    const game = gameFor((request.params as { game: string }).game)
    const user = await requireUser(request)
    const packs = await visiblePacks(pool, game)
    const standalone = await standaloneLevels(pool, game)
    const quick = game.leaderboards!.quickBoards
    const keys = [
      ...quick.map(board => board.key),
      ...standalone.map(level => game.leaderboards!.boardKey(level).key),
    ]
    const summaries = await boardSummaries(pool, game, keys, user.id, summaryLimit)
    const summaryFor = (key: string) => summaries.get(key) ?? { top: [], you: null, total: 0 }
    return {
      game: game.id,
      quick: quick.map(board => ({ board: boardInfo(game, board), ...summaryFor(board.key) })),
      packs: await Promise.all(packs.map(pack => packSummary(pool, game, pack, user.id))),
      standalone: standalone.map(level => {
        const board = game.leaderboards!.boardKey(level)
        return { level, board: boardInfo(game, board, level), ...summaryFor(board.key) }
      }),
      player: await playerSummary(pool, user.id, game.id),
    }
  })

  app.get('/api/leaderboards/games/:game/boards/:key', async request => {
    const game = gameFor((request.params as { game: string }).game)
    const user = await requireUser(request)
    const key = (request.params as { key: string }).key
    const board = game.leaderboards!.parseBoard(key)
    if (!board) throw new HttpError(404, 'leaderboard_board_not_found')
    const level = board.kind === 'level' ? await levelForBoard(pool, game, board) : undefined
    if (board.kind === 'level' && !level) throw new HttpError(404, 'leaderboard_level_not_found')
    const info = boardInfo(game, board, level, level ? await packTitleFor(pool, level) : undefined)
    const summary = (await boardSummaries(pool, game, [key], user.id, leaderboardTopLimit)).get(key)
      ?? { top: [], you: null, total: 0 }
    const { rows: [cooldownRow] } = await pool.query<PlayerRow>(`SELECT game_id, board_key, board_kind, board_meta,
        level_title, pack_title, seed_code, score_value, value_unit, completed_at, recorded_at
      FROM leaderboard_results WHERE owner_id=$1 AND game_id=$2 AND board_key=$3 AND status='cooldown'
      ORDER BY recorded_at DESC, id DESC LIMIT 1`, [user.id, game.id, key])
    const cooldown: LeaderboardCooldown | null = cooldownRow ? {
      board: boardFromPlayer(cooldownRow), value: Number(cooldownRow.score_value),
      unit: cooldownRow.value_unit as LeaderboardValueUnit,
      completedAt: iso(cooldownRow.completed_at), recordedAt: iso(cooldownRow.recorded_at),
      visibleAt: new Date(Date.parse(iso(cooldownRow.recorded_at)) + leaderboardCooldownDays * 86_400_000).toISOString(),
    } : null
    return { board: info, ...summary, level, cooldown }
  })

  app.get('/api/users/:id/avatar', async (request, reply) => {
    await requireUser(request)
    const id = z.uuid().parse((request.params as { id: string }).id)
    const { rows: [user] } = await pool.query<{ avatar: string | null }>(
      'SELECT COALESCE(custom_avatar,pocket_avatar) AS avatar FROM users WHERE id=$1', [id])
    const avatar = user?.avatar
    if (!avatar) throw new HttpError(404, 'not_found')
    const data = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i.exec(avatar)
    if (data) {
      return reply.type(data[1]).header('Cache-Control', 'private, max-age=86400')
        .send(Buffer.from(data[2], 'base64'))
    }
    if (avatar.startsWith('/') || /^https?:\/\//i.test(avatar))
      return reply.header('Cache-Control', 'private, max-age=86400').redirect(avatar)
    throw new HttpError(404, 'not_found')
  })

  app.get('/api/leaderboards/games/:game/boards/:key/records', async request => {
    const game = gameFor((request.params as { game: string }).game)
    const user = await requireUser(request)
    const key = (request.params as { key: string }).key
    if (!game.leaderboards!.parseBoard(key)) throw new HttpError(404, 'leaderboard_board_not_found')
    const query = z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query)
    const { rows } = await pool.query<SummaryRow & { total: number }>(`WITH ranked AS (
        SELECT r.*, (rank() OVER (ORDER BY rank_value))::int AS rank, (count(*) OVER ())::int AS total
        FROM leaderboard_results r
        WHERE r.game_id=$1 AND r.board_key=$2 AND r.status='active'
      )
      SELECT ranked.*, COALESCE(u.display_name,u.name) AS name, COALESCE(u.custom_avatar,u.pocket_avatar) AS avatar
      FROM ranked JOIN users u ON u.id=ranked.owner_id
      ORDER BY ranked.rank_value, ranked.completed_at, ranked.id
      OFFSET $3 LIMIT $4`, [game.id, key, query.offset, query.limit])
    const levels = await levelsForPairs(pool, game, rows.map(row => [row.level_id, row.level_revision] as const))
    return { rows: rows.map(row => standing(row, user.id, levels.get(row.level_id + ':' + row.level_revision))),
      total: rows[0]?.total ?? 0 } satisfies LeaderboardRecords
  })

  app.get('/api/leaderboards/games/:game/packs/:id/:revision', async request => {
    const game = gameFor((request.params as { game: string }).game)
    const user = await requireUser(request)
    const { id, revision } = request.params as { id: string; revision: string }
    const packs = await visiblePacks(pool, game)
    const pack = packs.find(item => item.id === id && item.revision === Number(revision))
    if (!pack) throw new HttpError(404, 'leaderboard_pack_not_found')
    const levels = game.packs!.levels(pack)
    const keys = levels.map(level => game.leaderboards!.boardKey(level).key)
    const summaries = await boardSummaries(pool, game, keys, user.id, 1)
    const levelItems = levels.map(level => {
      const board = game.leaderboards!.boardKey(level)
      const info = boardInfo(game, board, level, pack.data.title)
      return { level, board: info, ...(summaries.get(board.key) ?? emptyLeaderboardSummary(info)) }
    })
    return { ...(await packSummary(pool, game, pack, user.id)), levels: levelItems }
  })

  app.get('/api/leaderboards/notices', async request => {
    const user = await requireUser(request)
    const { rows } = await pool.query<{ id: string; value: string | number; unit: string; game: string;
      boardKey: string; boardKind: string; boardMeta: unknown; levelTitle: string; packTitle: string | null;
      seedCode: string | null; adminName: string; reason: string; removedAt: Date | string }>(`SELECT
        m.result_id AS id, r.score_value AS value, r.value_unit AS unit, r.game_id AS game,
        r.board_key AS "boardKey", r.board_kind AS "boardKind", r.board_meta AS "boardMeta",
        r.level_title AS "levelTitle", r.pack_title AS "packTitle", r.seed_code AS "seedCode",
        COALESCE(a.display_name,a.name) AS "adminName", m.reason, m.removed_at AS "removedAt"
      FROM leaderboard_removals m
      JOIN leaderboard_results r ON r.id=m.result_id
      JOIN users a ON a.id=m.admin_id
      WHERE r.owner_id=$1 AND m.acknowledged_at IS NULL
      ORDER BY m.removed_at`, [user.id])
    return { notices: rows.map(row => ({
      id: row.id, value: Number(row.value), unit: row.unit as LeaderboardValueUnit,
      board: boardFromResult({ ...row, boardKey: row.boardKey, boardKind: row.boardKind, boardMeta: row.boardMeta,
        levelTitle: row.levelTitle, packTitle: row.packTitle }),
      seedCode: row.seedCode, adminName: row.adminName, reason: row.reason,
      removedAt: iso(row.removedAt),
    } satisfies LeaderboardRemovalNotice)) }
  })

  app.post('/api/leaderboards/notices/:id/ack', async (request, reply) => {
    const user = await requireUser(request)
    const id = resultId(request)
    const updated = await pool.query(`UPDATE leaderboard_removals m SET acknowledged_at=now()
      FROM leaderboard_results r
      WHERE m.result_id=r.id AND r.owner_id=$1 AND m.result_id=$2 AND m.acknowledged_at IS NULL`, [user.id, id])
    if (!updated.rowCount) {
      const owned = await pool.query('SELECT 1 FROM leaderboard_results WHERE id=$1 AND owner_id=$2', [id, user.id])
      if (!owned.rowCount) throw new HttpError(404, 'leaderboard_notice_not_found')
    }
    return reply.code(204).send()
  })

  app.get('/api/admin/leaderboards/results', async request => {
    await requireUser(request, 'admin')
    const query = z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(leaderboardResultStatuses).optional(),
      game: gameParam.optional(),
    }).parse(request.query)
    const { rows } = await pool.query<{ id: string; playerName: string; game: string; boardKey: string;
      boardKind: string; boardMeta: unknown; levelTitle: string; packTitle: string | null; seedCode: string | null;
      value: string | number; unit: string; completedAt: Date | string; recordedAt: Date | string;
      status: string; aids: unknown }>(`SELECT r.id, COALESCE(u.display_name,u.name) AS "playerName",
        r.game_id AS game, r.board_key AS "boardKey", r.board_kind AS "boardKind", r.board_meta AS "boardMeta",
        r.level_title AS "levelTitle", r.pack_title AS "packTitle", r.seed_code AS "seedCode",
        r.score_value AS value, r.value_unit AS unit, r.completed_at AS "completedAt",
        r.recorded_at AS "recordedAt", r.status, r.aids
      FROM leaderboard_results r JOIN users u ON u.id=r.owner_id
      WHERE ($1::text IS NULL OR COALESCE(u.display_name,u.name) ILIKE '%'||$1||'%' OR r.level_title ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR r.status=$2) AND ($3::text IS NULL OR r.game_id=$3)
      ORDER BY r.recorded_at DESC LIMIT 100`,
    [query.q ?? null, query.status ?? null, query.game ?? null])
    return rows.map(row => ({
      id: row.id, playerName: row.playerName, game: row.game, value: Number(row.value),
      unit: row.unit as LeaderboardValueUnit,
      completedAt: iso(row.completedAt), recordedAt: iso(row.recordedAt),
      status: row.status, aids: row.aids,
      board: boardFromResult({ ...row, boardKey: row.boardKey, boardKind: row.boardKind, boardMeta: row.boardMeta,
        levelTitle: row.levelTitle, packTitle: row.packTitle }),
    }))
  })

  app.post('/api/admin/leaderboards/results/:id/remove', async request => {
    const admin = await requireUser(request, 'admin')
    const id = resultId(request)
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body)
    await transaction(async db => {
      const result = await db.query('SELECT id FROM leaderboard_results WHERE id=$1 FOR UPDATE', [id])
      if (!result.rowCount) throw new HttpError(404, 'leaderboard_result_not_found')
      await db.query(`UPDATE leaderboard_results SET status='removed' WHERE id=$1`, [id])
      await db.query(`INSERT INTO leaderboard_removals(result_id,admin_id,reason) VALUES($1,$2,$3)
        ON CONFLICT (result_id) DO NOTHING`, [id, admin.id, reason])
    })
    return { id, status: 'removed' }
  })

  app.get('/api/admin/leaderboards/removals', async request => {
    await requireUser(request, 'admin')
    const { rows } = await pool.query<{ id: string; playerName: string; adminName: string; reason: string;
      removedAt: Date | string; acknowledgedAt: Date | string | null; value: string | number; unit: string;
      game: string; boardKey: string; boardKind: string; boardMeta: unknown; levelTitle: string;
      packTitle: string | null; seedCode: string | null }>(`SELECT m.result_id AS id,
        COALESCE(p.display_name,p.name) AS "playerName", COALESCE(a.display_name,a.name) AS "adminName",
        m.reason, m.removed_at AS "removedAt", m.acknowledged_at AS "acknowledgedAt",
        r.score_value AS value, r.value_unit AS unit, r.game_id AS game, r.board_key AS "boardKey",
        r.board_kind AS "boardKind", r.board_meta AS "boardMeta", r.level_title AS "levelTitle",
        r.pack_title AS "packTitle", r.seed_code AS "seedCode"
      FROM leaderboard_removals m
      JOIN leaderboard_results r ON r.id=m.result_id
      JOIN users p ON p.id=r.owner_id
      JOIN users a ON a.id=m.admin_id
      ORDER BY m.removed_at DESC LIMIT 100`)
    return rows.map(row => ({
      id: row.id, playerName: row.playerName, adminName: row.adminName, reason: row.reason,
      removedAt: iso(row.removedAt),
      acknowledgedAt: row.acknowledgedAt ? iso(row.acknowledgedAt) : null,
      value: Number(row.value), unit: row.unit as LeaderboardValueUnit, seedCode: row.seedCode,
      board: boardFromResult({ ...row, boardKey: row.boardKey, boardKind: row.boardKind, boardMeta: row.boardMeta,
        levelTitle: row.levelTitle, packTitle: row.packTitle }),
    }))
  })
}
