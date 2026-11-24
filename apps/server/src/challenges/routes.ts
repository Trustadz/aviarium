import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type {
  ChallengeLevelView, ChallengePlayerSlot, ChallengePlayerStatus, ChallengeReplay, ChallengeSlotView, ChallengeStandings,
} from '../../../../packages/game-sdk/src/challenges.js'
import type { LeaderboardStanding } from '../../../../packages/game-sdk/src/leaderboards.js'
import { HttpError, requireUser } from '../auth.js'
import { challengeTimeZone, challengesEnabled, pool, testEnvironment } from '../config.js'
import { serverGames } from '../games.js'
import { boardSummaries } from '../leaderboards.js'
import { challengeGames } from './registry.js'
import {
  ensureOccurrence, occurrenceView, prepareOccurrence, readSeries, seriesView, syncSeriesTimezone,
  type OccurrenceRow, type SeriesRow, type SlotRow,
} from './store.js'

const occurrenceIdParam = (request: FastifyRequest) => z.uuid().parse((request.params as { id: string }).id)
const slotIdParam = (request: FastifyRequest) => z.uuid().parse((request.params as { id: string }).id)
const gameParam = z.string().regex(/^[a-z0-9-]{1,64}$/)
const iso = (value: Date | string) => new Date(value).toISOString()

/** A test-only clock makes reset/boundary browser tests deterministic. */
export function requestNow(request: FastifyRequest): number {
  const header = request.headers['x-aviarium-test-now']
  if (!testEnvironment || typeof header !== 'string') return Date.now()
  const parsed = Date.parse(header)
  if (!Number.isFinite(parsed) || Math.abs(parsed - Date.now()) > 400 * 86_400_000)
    throw new HttpError(400, 'invalid_request')
  return parsed
}

function levelView(level: {
  id: string; revision: number; ruleset: number; title: string; source: string;
  difficulty?: string | null; grid?: string | null; content?: unknown; game_id?: string; game?: string;
}): ChallengeLevelView {
  return {
    id: level.id, revision: level.revision, ruleset: level.ruleset, title: level.title,
    source: level.source as ChallengeLevelView['source'],
    game: level.game ?? level.game_id,
    difficulty: level.difficulty ?? undefined,
    grid: level.grid ?? undefined,
    content: level.content ?? undefined,
  }
}

interface AttemptRow {
  id: string
  status: 'started' | 'completed' | 'closed'
  session_id: string
  started_at: Date | string
  completed_at: Date | string | null
}

interface ChallengeResultRow {
  id: string
  status: 'active' | 'cooldown' | 'removed'
  score_value: string | number
  value_unit: string
}

async function loadOccurrence(id: string): Promise<OccurrenceRow | undefined> {
  const { rows: [row] } = await pool.query<OccurrenceRow>('SELECT * FROM challenge_occurrences WHERE id=$1', [id])
  return row
}

async function loadSlot(id: string): Promise<{ slot: SlotRow; occurrence: OccurrenceRow } | undefined> {
  const { rows: [slot] } = await pool.query<SlotRow>('SELECT * FROM challenge_slots WHERE id=$1', [id])
  if (!slot) return
  const occurrence = await loadOccurrence(slot.occurrence_id)
  return occurrence ? { slot, occurrence } : undefined
}

async function loadLevel(slot: SlotRow) {
  if (!slot.level_id || !slot.level_revision) return
  const { rows: [level] } = await pool.query<{
    id: string; revision: number; ruleset: number; title: string; source: string;
    difficulty: string | null; grid: string | null; content: unknown; game: string;
  }>(`SELECT id,revision,ruleset,title,source,difficulty,grid,content,game_id AS game
    FROM published_levels WHERE id=$1 AND revision=$2`, [slot.level_id, slot.level_revision])
  return level
}

async function loadAttempt(slotId: string, ownerId: string): Promise<AttemptRow | undefined> {
  const { rows: [attempt] } = await pool.query<AttemptRow>(`SELECT id,status,session_id,started_at,completed_at
    FROM challenge_attempts WHERE slot_id=$1 AND owner_id=$2`, [slotId, ownerId])
  return attempt
}

async function loadPlayerResult(slotId: string, ownerId: string): Promise<ChallengeResultRow | undefined> {
  const { rows: [result] } = await pool.query<ChallengeResultRow>(`SELECT id,status,score_value,value_unit
    FROM leaderboard_results WHERE challenge_slot_id=$1 AND owner_id=$2`, [slotId, ownerId])
  return result
}

function playerStatus(occurrence: OccurrenceRow, slot: SlotRow, attempt: AttemptRow | undefined,
  now: number, registered: boolean): ChallengePlayerStatus {
  if (slot.status !== 'ready' || !slot.level_id || !registered) return 'unavailable'
  const open = Date.parse(iso(occurrence.starts_at)) <= now && now < Date.parse(iso(occurrence.ends_at))
  if (!attempt) return open ? 'available' : 'missed'
  if (attempt.status === 'completed') return 'completed'
  if (attempt.status === 'closed') return 'closed'
  return open ? 'started' : 'expired'
}

async function standingsFor(slot: SlotRow, viewer: string): Promise<ChallengeStandings> {
  const game = serverGames.get(slot.game_id)
  if (!game) return { top: [], you: null, total: 0 }
  const key = 'challenge:' + slot.id
  const summary = (await boardSummaries(pool, game, [key], viewer, 3)).get(key)
  return { top: summary?.top ?? [], you: summary?.you ?? null, total: summary?.total ?? 0 }
}

async function slotView(occurrence: OccurrenceRow, slot: SlotRow, viewer: string, now: number,
  includeReplay: boolean): Promise<ChallengeSlotView> {
  const [attempt, playerResult, level, standings] = await Promise.all([
    loadAttempt(slot.id, viewer), loadPlayerResult(slot.id, viewer), loadLevel(slot), standingsFor(slot, viewer),
  ])
  const registered = serverGames.has(slot.game_id)
  const status = playerStatus(occurrence, slot, attempt, now, registered)
  const player: ChallengePlayerSlot = { status }
  if (attempt) {
    player.attemptId = attempt.id
    player.sessionId = attempt.session_id
    player.startedAt = iso(attempt.started_at)
  }
  if (playerResult) {
    player.result = {
      id: playerResult.id,
      status: playerResult.status === 'removed' ? 'removed' : 'active',
      rank: playerResult.status === 'active' ? standings.you?.rank ?? null : null,
      total: standings.total,
      value: Number(playerResult.score_value),
      unit: 'ms',
    }
  }
  const past = now >= Date.parse(iso(occurrence.ends_at))
  const replay: ChallengeReplay | undefined = includeReplay && past && slot.seed && slot.status === 'ready'
    ? { game: slot.game_id, seed: slot.seed, options: slot.options, rules: slot.rules,
      generatorVersion: slot.generator_version ?? 1 }
    : undefined
  return {
    id: slot.id, game: slot.game_id, position: slot.position, status: slot.status,
    options: slot.options, rules: slot.rules,
    level: level ? levelView(level) : undefined,
    player, standings, replay,
    failureCode: slot.failure_code,
  }
}

async function openCount(occurrence: OccurrenceRow, viewer: string, now: number): Promise<number> {
  if (now < Date.parse(iso(occurrence.starts_at)) || now >= Date.parse(iso(occurrence.ends_at))) return 0
  const { rows } = await pool.query<{ status: string; attempt_status: string | null }>(`SELECT s.status,
      a.status AS attempt_status
    FROM challenge_slots s
    LEFT JOIN challenge_attempts a ON a.slot_id=s.id AND a.owner_id=$2
    WHERE s.occurrence_id=$1`, [occurrence.id, viewer])
  return rows.filter(row => row.status === 'ready' && (row.attempt_status === null || row.attempt_status === 'started')).length
}

async function enabledSeries(): Promise<{ enabled: boolean; series?: SeriesRow }> {
  if (!challengesEnabled) return { enabled: false }
  const series = await readSeries(pool)
  if (!series) return { enabled: false }
  return { enabled: series.enabled, series }
}

export function registerChallenges(app: FastifyInstance) {
  app.get('/api/challenges/summary', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const serverNow = new Date(now).toISOString()
    const { enabled, series } = await enabledSeries()
    if (!enabled || !series) return { enabled: false, open: 0, serverNow, occurrence: null, series: null, nextStart: null }

    const ensured = await ensureOccurrence(pool, series, now)
    let occurrence = ensured.occurrence
    if (occurrence && !occurrence.prepared_at) {
      const prepared = await prepareOccurrence(pool, occurrence, challengeGames, series)
      occurrence = await loadOccurrence(occurrence.id)
      if (prepared.preparing && occurrence) occurrence.preparing_at = new Date()
    }
    const open = occurrence ? await openCount(occurrence, user.id, now) : 0
    return {
      enabled: true, open, serverNow,
      occurrence: occurrence ? occurrenceView(occurrence) : null,
      series: seriesView(series),
      nextStart: ensured.nextStart ? new Date(ensured.nextStart).toISOString() : null,
    }
  })

  app.get('/api/challenges', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const serverNow = new Date(now).toISOString()
    const { enabled, series } = await enabledSeries()
    if (!enabled || !series)
      return { enabled: false, slots: [], open: 0, serverNow, occurrence: null, series: null, nextStart: null }

    const ensured = await ensureOccurrence(pool, series, now)
    let occurrence = ensured.occurrence
    if (occurrence && !occurrence.prepared_at) {
      await prepareOccurrence(pool, occurrence, challengeGames, series)
      occurrence = await loadOccurrence(occurrence.id)
    }
    if (!occurrence) {
      return {
        enabled: true, slots: [], open: 0, serverNow, occurrence: null, series: seriesView(series),
        nextStart: ensured.nextStart ? new Date(ensured.nextStart).toISOString() : null,
      }
    }
    const { rows: slots } = await pool.query<SlotRow>('SELECT * FROM challenge_slots WHERE occurrence_id=$1 ORDER BY position',
      [occurrence.id])
    const views = await Promise.all(slots.map(slot => slotView(occurrence!, slot, user.id, now, false)))
    return {
      enabled: true, slots: views, open: await openCount(occurrence, user.id, now), serverNow,
      occurrence: occurrenceView(occurrence), series: seriesView(series), nextStart: null,
    }
  })

  app.get('/api/challenges/games', async request => {
    await requireUser(request)
    return challengeGames.map(game => ({ id: game.id, label: game.label, optionGroups: game.optionGroups }))
  })

  app.get('/api/challenges/history', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const query = z.object({
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(request.query)
    const before = query.before ? new Date(query.before) : new Date(now)
    const { rows: occurrences } = await pool.query<OccurrenceRow>(`SELECT * FROM challenge_occurrences
      WHERE ends_at <= $1 AND ends_at < $2 ORDER BY ends_at DESC LIMIT $3`,
    [new Date(now), before, query.limit])
    const days = await Promise.all(occurrences.map(async occurrence => {
      const { rows: slots } = await pool.query<SlotRow>('SELECT * FROM challenge_slots WHERE occurrence_id=$1 ORDER BY position',
        [occurrence.id])
      const views = await Promise.all(slots.map(slot => slotView(occurrence, slot, user.id, now, true)))
      return { occurrence: occurrenceView(occurrence), slots: views }
    }))
    return {
      serverNow: new Date(now).toISOString(),
      occurrences: days,
      nextBefore: occurrences.length === query.limit ? iso(occurrences[occurrences.length - 1]!.ends_at) : null,
    }
  })

  app.get('/api/challenges/:occurrenceId', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const occurrence = await loadOccurrence(occurrenceIdParam(request))
    if (!occurrence || Date.parse(iso(occurrence.starts_at)) > now) throw new HttpError(404, 'challenge_not_found')
    const series = await readSeries(pool, occurrence.series_id)
    const { rows: slots } = await pool.query<SlotRow>('SELECT * FROM challenge_slots WHERE occurrence_id=$1 ORDER BY position',
      [occurrence.id])
    const views = await Promise.all(slots.map(slot => slotView(occurrence, slot, user.id, now, true)))
    const open = series?.enabled && now < Date.parse(iso(occurrence.ends_at))
      ? await openCount(occurrence, user.id, now) : 0
    return {
      enabled: Boolean(series?.enabled), slots: views, open, serverNow: new Date(now).toISOString(),
      occurrence: occurrenceView(occurrence), series: series ? seriesView(series) : null, nextStart: null,
    }
  })

  app.get('/api/challenges/:occurrenceId/slots/:gameId/board', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const occurrence = await loadOccurrence(occurrenceIdParam(request))
    if (!occurrence) throw new HttpError(404, 'challenge_not_found')
    const game = gameParam.parse((request.params as { gameId: string }).gameId)
    const { rows: [slot] } = await pool.query<SlotRow>(`SELECT * FROM challenge_slots
      WHERE occurrence_id=$1 AND game_id=$2`, [occurrence.id, game])
    if (!slot) throw new HttpError(404, 'challenge_not_found')
    const limit = z.object({ limit: z.coerce.number().int().min(1).max(20).default(20) }).parse(request.query).limit
    const serverGame = serverGames.get(game)
    const key = 'challenge:' + slot.id
    const summary = serverGame ? (await boardSummaries(pool, serverGame, [key], user.id, limit)).get(key) : undefined
    const level = await loadLevel(slot)
    return {
      board: {
        game, key, kind: 'challenge' as const,
        ...(level?.difficulty ? { difficulty: level.difficulty } : {}),
        levelId: slot.level_id ?? undefined, levelRevision: slot.level_revision ?? undefined,
        levelTitle: level?.title,
        challenge: { occurrenceId: occurrence.id, periodKey: occurrence.period_key, slotId: slot.id,
          timeZone: occurrence.timezone },
      },
      slot: { id: slot.id, game: slot.game_id, options: slot.options, rules: slot.rules,
        playerStatus: playerStatus(occurrence, slot, await loadAttempt(slot.id, user.id), now, Boolean(serverGame)) },
      top: summary?.top ?? [], you: summary?.you ?? null, total: summary?.total ?? 0,
      serverNow: new Date(now).toISOString(),
    }
  })

  app.post('/api/challenges/slots/:slotId/start', async request => {
    const user = await requireUser(request)
    const now = requestNow(request)
    const loaded = await loadSlot(slotIdParam(request))
    if (!loaded) throw new HttpError(404, 'challenge_not_found')
    const { slot, occurrence } = loaded
    const series = await enabledSeries()
    if (!series.enabled) throw new HttpError(409, 'challenge_disabled')
    const startsAt = Date.parse(iso(occurrence.starts_at))
    const endsAt = Date.parse(iso(occurrence.ends_at))
    if (now < startsAt) throw new HttpError(409, 'challenge_closed')
    if (now >= endsAt) throw new HttpError(409, 'challenge_closed')
    if (slot.status !== 'ready' || !slot.level_id) throw new HttpError(409, 'challenge_slot_unavailable')
    if (!serverGames.has(slot.game_id) || !challengeGames.some(game => game.id === slot.game_id))
      throw new HttpError(409, 'challenge_game_unsupported')

    const existing = await loadAttempt(slot.id, user.id)
    if (existing?.status === 'completed') throw new HttpError(409, 'challenge_already_completed')
    if (existing?.status === 'closed') throw new HttpError(409, 'challenge_closed')
    if (existing?.status === 'started') {
      const level = await loadLevel(slot)
      if (!level) throw new HttpError(409, 'challenge_slot_unavailable')
      return {
        attemptId: existing.id, sessionId: existing.session_id, startedAt: iso(existing.started_at), resumed: true,
        occurrence: { id: occurrence.id, periodKey: occurrence.period_key, endsAt: iso(occurrence.ends_at), timezone: occurrence.timezone },
        slot: { id: slot.id, game: slot.game_id, position: slot.position, level: levelView(level),
          options: slot.options, rules: slot.rules },
      }
    }

    const sessionId = crypto.randomUUID()
    const { rows: [attempt] } = await pool.query<AttemptRow>(`INSERT INTO challenge_attempts(
        slot_id,occurrence_id,owner_id,session_id,started_at,status
      ) VALUES($1,$2,$3,$4,$5,'started')
      ON CONFLICT (slot_id,owner_id) DO NOTHING
      RETURNING id,status,session_id,started_at,completed_at`,
    [slot.id, occurrence.id, user.id, sessionId, new Date(now)])
    if (!attempt) {
      const raced = await loadAttempt(slot.id, user.id)
      if (raced?.status === 'started') {
        const level = await loadLevel(slot)
        if (!level) throw new HttpError(409, 'challenge_slot_unavailable')
        return {
          attemptId: raced.id, sessionId: raced.session_id, startedAt: iso(raced.started_at), resumed: true,
          occurrence: { id: occurrence.id, periodKey: occurrence.period_key, endsAt: iso(occurrence.ends_at), timezone: occurrence.timezone },
          slot: { id: slot.id, game: slot.game_id, position: slot.position, level: levelView(level),
            options: slot.options, rules: slot.rules },
        }
      }
      throw new HttpError(409, raced?.status === 'completed' ? 'challenge_already_completed' : 'challenge_closed')
    }
    await pool.query('UPDATE challenge_slots SET attempts=attempts+1, updated_at=now() WHERE id=$1', [slot.id])
    const level = await loadLevel(slot)
    if (!level) throw new HttpError(409, 'challenge_slot_unavailable')
    return {
      attemptId: attempt.id, sessionId: attempt.session_id, startedAt: iso(attempt.started_at), resumed: false,
      occurrence: { id: occurrence.id, periodKey: occurrence.period_key, endsAt: iso(occurrence.ends_at), timezone: occurrence.timezone },
      slot: { id: slot.id, game: slot.game_id, position: slot.position, level: levelView(level),
        options: slot.options, rules: slot.rules },
    }
  })

  // Keep the series timezone in step with the environment without relabelling history.
  void syncSeriesTimezone(pool, challengeTimeZone).catch(() => undefined)
}
