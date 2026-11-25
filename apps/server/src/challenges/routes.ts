import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type {
  ChallengeLevelView, ChallengePlayerSlot, ChallengePlayerStatus, ChallengeReplay, ChallengeSlotView, ChallengeStandings,
} from '../../../../packages/game-sdk/src/challenges.js'
import type { LeaderboardStanding } from '../../../../packages/game-sdk/src/leaderboards.js'
import { HttpError, requireUser } from '../auth.js'
import { challengeTimeZone, challengesEnabled, pool, testEnvironment, transaction } from '../config.js'
import type { ServerGame } from '../game-runtime.js'
import { boardSummaries } from '../leaderboards.js'
import { requestNow } from './now.js'
import {
  addCivilDays, localBoundary, nextOccurrenceStart, occurrenceFor, parsePeriodKey,
} from './time.js'
import type { ChallengeGameRuntime } from './types.js'
import type { ChallengeGameSelection } from '../../../../packages/game-sdk/src/challenges.js'
import {
  ensureOccurrence, minimumWindowMinutes, normalizeSelections, occurrenceView, prepareOccurrence, readSeries,
  seriesView, syncSeriesTimezone,
  type OccurrenceRow, type SeriesRow, type SlotRow,
} from './store.js'

const occurrenceIdParam = (request: FastifyRequest) =>
  z.uuid().parse((request.params as { occurrenceId: string }).occurrenceId)
const slotIdParam = (request: FastifyRequest) =>
  z.uuid().parse((request.params as { slotId: string }).slotId)
const gameParam = z.string().regex(/^[a-z0-9-]{1,64}$/)
const iso = (value: Date | string) => new Date(value).toISOString()


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

function stripChallengeStanding(row: LeaderboardStanding | null): LeaderboardStanding | null {
  if (!row) return null
  return { ...row, seedCode: null, level: row.level ? { ...row.level, seed: null, generatorVersion: null } : undefined }
}

async function standingsFor(slot: SlotRow, viewer: string,
  serverGames: ReadonlyMap<string, ServerGame>): Promise<ChallengeStandings> {
  const game = serverGames.get(slot.game_id)
  if (!game) return { top: [], you: null, total: 0 }
  const key = 'challenge:' + slot.id
  const summary = (await boardSummaries(pool, game, [key], viewer, 3)).get(key)
  return {
    top: (summary?.top ?? []).map(row => stripChallengeStanding(row)!).filter(Boolean),
    you: stripChallengeStanding(summary?.you ?? null),
    total: summary?.total ?? 0,
  }
}

async function slotView(occurrence: OccurrenceRow, slot: SlotRow, viewer: string, now: number,
  includeReplay: boolean, serverGames: ReadonlyMap<string, ServerGame>): Promise<ChallengeSlotView> {
  const [attempt, playerResult, level, standings] = await Promise.all([
    loadAttempt(slot.id, viewer), loadPlayerResult(slot.id, viewer), loadLevel(slot), standingsFor(slot, viewer, serverGames),
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

export function registerChallenges(app: FastifyInstance, serverGames: ReadonlyMap<string, ServerGame>,
  challengeGames: readonly ChallengeGameRuntime[]) {
  // Apply TZ before the server accepts requests; existing occurrences keep their
  // timezone snapshot, while new occurrences use the environment zone.
  app.addHook('onReady', async () => { await syncSeriesTimezone(pool, challengeTimeZone) })
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
    const views = await Promise.all(slots.map(slot => slotView(occurrence!, slot, user.id, now, false, serverGames)))
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
      const views = await Promise.all(slots.map(slot => slotView(occurrence, slot, user.id, now, true, serverGames)))
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
    const views = await Promise.all(slots.map(slot => slotView(occurrence, slot, user.id, now, true, serverGames)))
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
    const top = (summary?.top ?? []).map(row => stripChallengeStanding(row)!).filter(Boolean)
    const you = stripChallengeStanding(summary?.you ?? null)
    const level = await loadLevel(slot)
    return {
      board: {
        game, key, kind: 'challenge' as const,
        ...(level?.difficulty ? { difficulty: level.difficulty } : {}),
        levelId: slot.level_id ?? undefined, levelRevision: slot.level_revision ?? undefined,
        levelTitle: level?.title,
        challenge: { occurrenceId: occurrence.id, periodKey: occurrence.period_key, slotId: slot.id,
          timeZone: occurrence.timezone, closed: now >= Date.parse(iso(occurrence.ends_at)) },
      },
      slot: { id: slot.id, game: slot.game_id, options: slot.options, rules: slot.rules,
        playerStatus: playerStatus(occurrence, slot, await loadAttempt(slot.id, user.id), now, Boolean(serverGame)) },
      top, you, total: summary?.total ?? 0,
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
      const { rows: [save] } = await pool.query<{ data: unknown; revision: number; archived: boolean; updatedAt: number }>(`
        SELECT data,revision,archived,floor(extract(epoch FROM updated_at) * 1000)::double precision AS "updatedAt"
        FROM saves WHERE id=$1 AND owner_id=$2`, [existing.session_id, user.id])
      return {
        attemptId: existing.id, sessionId: existing.session_id, startedAt: iso(existing.started_at), resumed: true,
        ...(save ? { save: { data: save.data, revision: save.revision, archived: save.archived, updatedAt: save.updatedAt } } : {}),
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

  function occurrenceSettings(series: SeriesRow) {
    return {
      gameLimit: series.game_limit,
      eligibleGames: series.eligible_games,
      gameOptions: series.game_options,
      gameSelections: series.game_selections,
    }
  }

  async function settingsPayload(series: SeriesRow, now: number) {
    const ensured = series.enabled ? await ensureOccurrence(pool, series, now) : { occurrence: undefined, nextStart: null }
    const nextStart = nextOccurrenceStart(now, series.timezone, series.reset_minute)
    const next = occurrenceFor(nextStart, series.timezone, series.reset_minute)
    return {
      ...seriesView(series),
      timezoneSource: 'env' as const,
      testEnvironment,
      registeredGames: challengeGames.map(game => ({
        id: game.id, label: game.label, optionGroups: game.optionGroups,
      })),
      current: ensured.occurrence ? occurrenceView(ensured.occurrence) : null,
      next: {
        periodKey: next.periodKey,
        startsAt: new Date(next.startsAt).toISOString(),
        endsAt: new Date(next.endsAt).toISOString(),
        timezone: series.timezone,
      },
      appliesFrom: new Date(nextStart).toISOString(),
      minimumWindowMinutes,
    }
  }

  app.get('/api/admin/challenges/settings', async request => {
    await requireUser(request, 'admin')
    const now = requestNow(request)
    const series = await readSeries(pool)
    if (!series) throw new HttpError(404, 'challenge_not_found')
    return settingsPayload(series, now)
  })

  app.patch('/api/admin/challenges/settings', async request => {
    await requireUser(request, 'admin')
    const optionIds = z.union([z.string(), z.number()])
    const input = z.strictObject({
      enabled: z.boolean().optional(),
      gameLimit: z.number().int().min(1).max(50).optional(),
      eligibleGames: z.array(gameParam).nullable().optional(),
      gameOptions: z.record(z.string(), z.record(z.string(), z.array(optionIds))).optional(),
      gameSelections: z.array(z.strictObject({
        game: gameParam,
        options: z.record(z.string(), z.array(optionIds)),
      })).min(1).optional(),
      resetMinute: z.number().int().min(0).max(1439).optional(),
      expectedUpdatedAt: z.string().datetime().optional(),
    }).parse(request.body)
    const now = requestNow(request)
    const series = await readSeries(pool)
    if (!series) throw new HttpError(404, 'challenge_not_found')
    if (input.expectedUpdatedAt && new Date(series.updated_at).toISOString() !== input.expectedUpdatedAt)
      throw new HttpError(409, 'challenge_settings_conflict')

    const capable = new Map(challengeGames.map(game => [game.id, game]))
    const normalize = (values: readonly (string | number)[] | undefined) => (values ?? []).map(String)
    const legacyEligible = input.eligibleGames === undefined ? series.eligible_games : input.eligibleGames
    const legacyOptions = { ...(series.game_options ?? {}), ...(input.gameOptions ?? {}) }
    let selections: ChallengeGameSelection[]
    if (input.gameSelections) {
      selections = input.gameSelections.map(selection => ({
        game: selection.game,
        options: Object.fromEntries(Object.entries(selection.options).map(([key, ids]) => [key, normalize(ids)])),
      }))
    } else if (input.eligibleGames !== undefined || input.gameOptions !== undefined) {
      const ids = legacyEligible ?? [...capable.keys()]
      selections = ids.map(game => ({ game, options: Object.fromEntries(
        Object.entries(legacyOptions[game] ?? {}).map(([key, values]) => [key, normalize(values as (string | number)[])])) }))
    } else {
      selections = normalizeSelections(series.game_selections.length ? series.game_selections :
        ([...capable.keys()].map(game => ({ game, options: legacyOptions[game] ?? {} })) as ChallengeGameSelection[]))
    }
    if (!selections.length) throw new HttpError(422, 'challenge_no_eligible_games')

    for (const selection of selections) {
      const game = capable.get(selection.game)
      if (!game) throw new HttpError(422, 'challenge_game_unknown', { game: selection.game })
      for (const group of game.optionGroups) {
        const ids = normalize(selection.options[group.key] ?? group.defaultEnabled)
          .filter(id => group.choices.some(choice => choice.id === id))
        if (!ids.length) throw new HttpError(422, 'challenge_options_required', { game: selection.game })
        selection.options[group.key] = ids
      }
    }
    const distinctGames = [...new Set(selections.map(selection => selection.game))]
    const options: Record<string, Record<string, string[]>> = {}
    const eligible: string[] = distinctGames
    for (const selection of selections) {
      const groups = options[selection.game] ??= {}
      for (const [key, ids] of Object.entries(selection.options)) {
        groups[key] = [...new Set([...(groups[key] ?? []), ...ids])]
      }
    }
    const gameLimit = input.gameLimit ?? series.game_limit
    if (gameLimit > distinctGames.length)
      throw new HttpError(422, 'challenge_game_limit_invalid', { count: String(distinctGames.length) })

    const { rows: [updated] } = await pool.query<SeriesRow>(`UPDATE challenge_series SET
        enabled=$1,game_limit=$2,eligible_games=$3,game_options=$4,reset_minute=$5,game_selections=$6,updated_at=now()
      WHERE id=$7 RETURNING *`,
    [input.enabled ?? series.enabled, gameLimit, eligible, JSON.stringify(options),
      input.resetMinute ?? series.reset_minute, JSON.stringify(selections), series.id])
    if (updated.enabled) {
      const ensured = await ensureOccurrence(pool, updated, now)
      if (ensured.occurrence && !ensured.occurrence.prepared_at)
        await prepareOccurrence(pool, ensured.occurrence, challengeGames, updated)
    }
    return settingsPayload(updated, now)
  })

  app.post('/api/admin/challenges/prepare', async request => {
    await requireUser(request, 'admin')
    const now = requestNow(request)
    const input = z.object({ periodKey: z.string().optional() }).parse(request.body ?? {})
    const series = await readSeries(pool)
    if (!series) throw new HttpError(404, 'challenge_not_found')
    let occurrence: OccurrenceRow | undefined
    if (input.periodKey) {
      const date = parsePeriodKey(input.periodKey)
      if (!date) throw new HttpError(400, 'invalid_request')
      const startsAt = localBoundary(date, series.reset_minute, series.timezone)
      const endsAt = localBoundary(addCivilDays(date, 1), series.reset_minute, series.timezone)
      const settings = occurrenceSettings(series)
      const { rows: [created] } = await pool.query<OccurrenceRow>(`INSERT INTO challenge_occurrences(
          series_id,period_key,starts_at,ends_at,timezone,reset_minute,generation_version,settings,seed)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (series_id,period_key) DO NOTHING RETURNING *`,
      [series.id, input.periodKey, new Date(startsAt), new Date(endsAt), series.timezone, series.reset_minute,
        series.generation_version, JSON.stringify(settings), crypto.randomUUID().replaceAll('-', '')])
      occurrence = created ?? (await pool.query<OccurrenceRow>(
        'SELECT * FROM challenge_occurrences WHERE series_id=$1 AND period_key=$2',
        [series.id, input.periodKey])).rows[0]
    } else {
      occurrence = (await ensureOccurrence(pool, series, now)).occurrence
    }
    if (!occurrence) throw new HttpError(409, 'challenge_prepare_failed')
    const prepared = await prepareOccurrence(pool, occurrence, challengeGames, series)
    const { rows: [fresh] } = await pool.query<OccurrenceRow>('SELECT * FROM challenge_occurrences WHERE id=$1',
      [occurrence.id])
    const { rows: slots } = await pool.query(`SELECT id,game_id,position,status,failure_code FROM challenge_slots
      WHERE occurrence_id=$1 ORDER BY position`, [occurrence.id])
    return { ...prepared, occurrence: fresh ? occurrenceView(fresh) : null, slots }
  })

  app.post('/api/admin/challenges/generate', async request => {
    // Deliberately test-only: production content changes apply from the next
    // occurrence, and there is no admin action that rewrites a live round.
    if (!testEnvironment) throw new HttpError(404, 'challenge_not_found')
    await requireUser(request, 'admin')
    const now = requestNow(request)
    const series = await readSeries(pool)
    if (!series) throw new HttpError(404, 'challenge_not_found')
    if (!series.enabled) throw new HttpError(409, 'challenge_disabled')
    const ensured = await ensureOccurrence(pool, series, now)
    if (!ensured.occurrence) throw new HttpError(409, 'challenge_prepare_failed')

    const occurrence = await transaction(async db => {
      await db.query(`DELETE FROM leaderboard_results
        WHERE challenge_slot_id IN (SELECT id FROM challenge_slots WHERE occurrence_id=$1)`, [ensured.occurrence!.id])
      await db.query('DELETE FROM challenge_attempts WHERE occurrence_id=$1', [ensured.occurrence!.id])
      await db.query('DELETE FROM challenge_slots WHERE occurrence_id=$1', [ensured.occurrence!.id])
      const { rows: [updated] } = await db.query<OccurrenceRow>(`UPDATE challenge_occurrences SET
          seed=$2,settings=$3,prepared_at=NULL,preparing_at=NULL,failure_code=NULL,generation_version=$4
        WHERE id=$1 RETURNING *`,
      [ensured.occurrence!.id, crypto.randomUUID().replaceAll('-', ''), JSON.stringify(occurrenceSettings(series)),
        series.generation_version])
      return updated!
    })
    const prepared = await prepareOccurrence(pool, occurrence, challengeGames, series)
    const { rows: [fresh] } = await pool.query<OccurrenceRow>('SELECT * FROM challenge_occurrences WHERE id=$1',
      [occurrence.id])
    const { rows: slots } = await pool.query(`SELECT id,game_id,position,status,failure_code FROM challenge_slots
      WHERE occurrence_id=$1 ORDER BY position`, [occurrence.id])
    return { ...prepared, occurrence: fresh ? occurrenceView(fresh) : null, slots }
  })

  // The startup hook above keeps the series timezone in step with TZ without
  // relabelling already prepared occurrences.
}

