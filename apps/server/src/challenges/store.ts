import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  ChallengeGeneratedLevel, ChallengeOptionGroup, ChallengeOptionValue, ChallengeSelection,
  ChallengeSeriesView, ChallengeSlotRecipe, ChallengeSlotStatus,
} from '../../../../packages/game-sdk/src/challenges.js'
import type { ChallengeGameRuntime } from './types.js'
import { occurrenceFor } from './time.js'

export const minimumWindowMinutes = 120

export interface SeriesRow {
  id: string
  kind: string
  enabled: boolean
  game_limit: number
  eligible_games: string[] | null
  game_options: Record<string, Record<string, string[]>>
  timezone: string
  reset_minute: number
  generation_version: number
  label: string | null
  metadata: Record<string, unknown>
  updated_at: Date | string
}

export interface OccurrenceRow {
  id: string
  series_id: string
  period_key: string
  starts_at: Date | string
  ends_at: Date | string
  timezone: string
  reset_minute: number
  generation_version: number
  settings: {
    gameLimit?: number
    eligibleGames?: string[] | null
    gameOptions?: Record<string, Record<string, string[]>>
  }
  seed: string
  preparing_at: Date | string | null
  prepared_at: Date | string | null
  failure_code: string | null
}

export interface SlotRow {
  id: string
  occurrence_id: string
  game_id: string
  position: number
  options: Record<string, ChallengeOptionValue>
  choices: Record<string, string>
  rules: Record<string, ChallengeOptionValue>
  seed: string | null
  level_id: string | null
  level_revision: number | null
  generator_version: number | null
  status: ChallengeSlotStatus
  failure_code: string | null
  attempts: number
}

export interface SlateGame {
  game: ChallengeGameRuntime
  position: number
  options: Record<string, ChallengeOptionValue>
  rules: Record<string, ChallengeOptionValue>
  seed: string
  groups: Record<string, string>
}

type Db = Pick<Pool, 'query'> | PoolClient

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const randomSeed = () => randomBytes(32).toString('hex')

export function seriesView(row: SeriesRow): ChallengeSeriesView {
  return {
    id: row.id,
    kind: row.kind as ChallengeSeriesView['kind'],
    enabled: row.enabled,
    gameLimit: row.game_limit,
    eligibleGames: row.eligible_games,
    gameOptions: row.game_options ?? {},
    timezone: row.timezone,
    resetMinute: row.reset_minute,
    generationVersion: row.generation_version,
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export function occurrenceView(row: OccurrenceRow) {
  return {
    id: row.id,
    periodKey: row.period_key,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    timezone: row.timezone,
    prepared: Boolean(row.prepared_at),
    preparing: Boolean(row.preparing_at && !row.prepared_at),
    failureCode: row.failure_code,
  }
}

export async function readSeries(db: Db, id = 'daily'): Promise<SeriesRow | undefined> {
  const { rows: [row] } = await db.query<SeriesRow>(`SELECT id,kind,enabled,game_limit,eligible_games,game_options,
    timezone,reset_minute,generation_version,label,metadata,updated_at
    FROM challenge_series WHERE id=$1`, [id])
  return row
}

/** Keep the series' timezone in step with TZ without relabelling history. */
export async function syncSeriesTimezone(db: Db, timeZone: string): Promise<void> {
  await db.query(`UPDATE challenge_series SET timezone=$1, updated_at=now()
    WHERE id='daily' AND timezone<>$1`, [timeZone])
}

export async function findContainingOccurrence(db: Db, series: SeriesRow, now: number): Promise<OccurrenceRow | undefined> {
  const { rows: [row] } = await db.query<OccurrenceRow>(`SELECT * FROM challenge_occurrences
    WHERE series_id=$1 AND starts_at <= $2 AND ends_at > $2
    ORDER BY starts_at DESC LIMIT 1`, [series.id, new Date(now)])
  return row
}

/**
 * Find or create the occurrence containing `now`. A daily challenge with less
 * than the minimum window remaining is not created; the caller shows the next
 * reset instead. The unique (series, period) key makes this safe across
 * concurrent requests and restarts.
 */
export async function ensureOccurrence(db: Db, series: SeriesRow, now: number): Promise<{
  occurrence: OccurrenceRow | undefined
  nextStart: number | null
}> {
  const current = await findContainingOccurrence(db, series, now)
  if (current) return { occurrence: current, nextStart: null }

  const window = occurrenceFor(now, series.timezone, series.reset_minute)
  if (window.endsAt - now < minimumWindowMinutes * 60_000)
    return { occurrence: undefined, nextStart: window.endsAt }

  const settings = {
    gameLimit: series.game_limit,
    eligibleGames: series.eligible_games,
    gameOptions: series.game_options,
  }
  const { rows: [inserted] } = await db.query<OccurrenceRow>(`INSERT INTO challenge_occurrences(
      series_id,period_key,starts_at,ends_at,timezone,reset_minute,generation_version,settings,seed
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (series_id,period_key) DO NOTHING
    RETURNING *`,
  [series.id, window.periodKey, new Date(window.startsAt), new Date(window.endsAt),
    series.timezone, series.reset_minute, series.generation_version, JSON.stringify(settings), randomSeed()])
  if (inserted) return { occurrence: inserted, nextStart: null }

  // Another request created it between our lookup and insert.
  const { rows: [existing] } = await db.query<OccurrenceRow>(`SELECT * FROM challenge_occurrences
    WHERE series_id=$1 AND period_key=$2`, [series.id, window.periodKey])
  return { occurrence: existing, nextStart: null }
}

function enabledChoices(series: SeriesRow, game: ChallengeGameRuntime, group: ChallengeOptionGroup) {
  const configured = series.game_options?.[game.id]?.[group.key]
  const ids = Array.isArray(configured) ? configured : group.defaultEnabled
  const known = new Map(group.choices.map(choice => [choice.id, choice]))
  return ids.flatMap(id => known.get(id) ?? [])
}

/** A game is eligible only when every required option group has an enabled value. */
export function eligibleGames(series: SeriesRow, games: readonly ChallengeGameRuntime[]): ChallengeGameRuntime[] {
  return games.filter(game => {
    if (series.eligible_games && !series.eligible_games.includes(game.id)) return false
    return game.optionGroups.every(group => enabledChoices(series, game, group).length > 0)
  })
}

function pick<T>(items: readonly T[], seed: string): T {
  const index = Number.parseInt(digest(seed).slice(0, 8), 16) % items.length
  return items[index]!
}

/**
 * Deterministic slate selection: the same occurrence seed and settings give
 * the same distinct games for every player and every retry.
 */
export function selectSlate(series: SeriesRow, occurrence: OccurrenceRow, games: readonly ChallengeGameRuntime[]): SlateGame[] {
  const snapshot: SeriesRow = {
    ...series,
    game_limit: occurrence.settings?.gameLimit ?? series.game_limit,
    eligible_games: occurrence.settings?.eligibleGames === undefined
      ? series.eligible_games : occurrence.settings.eligibleGames,
    game_options: occurrence.settings?.gameOptions ?? series.game_options,
  }
  const eligible = eligibleGames(snapshot, games)
  const ordered = [...eligible].sort((a, b) =>
    digest(occurrence.seed + '|slate|' + a.id).localeCompare(digest(occurrence.seed + '|slate|' + b.id)) || a.id.localeCompare(b.id))
  const count = Math.min(snapshot.game_limit, ordered.length)
  return ordered.slice(0, count).map((game, position) => {
    const groups: Record<string, string> = {}
    const options: Record<string, ChallengeOptionValue> = {}
    const rules: Record<string, ChallengeOptionValue> = {}
    for (const group of game.optionGroups) {
      const choices = enabledChoices(snapshot, game, group)
      const choice = pick(choices, occurrence.seed + '|slot|' + game.id + '|' + group.key)
      groups[group.key] = choice.id
      ;(group.kind === 'rule' ? rules : options)[group.key] = choice.value
    }
    return {
      game, position, groups, options, rules,
      seed: digest(occurrence.seed + '|slot|' + game.id + '|' + JSON.stringify(groups)),
    }
  })
}

function selectionFor(slot: SlotRow): ChallengeSelection {
  return { groups: slot.choices ?? {}, options: slot.options ?? {}, rules: slot.rules ?? {} }
}

export function challengeLevelId(periodKey: string, gameId: string, seed: string): string {
  return ('challenge-' + periodKey.replaceAll('-', '') + '-' + gameId + '-' + digest(seed).slice(0, 10)).slice(0, 64)
}

async function persistLevel(db: PoolClient, levelId: string, gameId: string, seed: string, generated: ChallengeGeneratedLevel) {
  await db.query(`INSERT INTO published_levels(id,revision,ruleset,title,grid,difficulty,source,seed,generator_version,
      validation,catalog_visible,game_id,content,rules)
    VALUES($1,1,$2,$3,$4,$5,'Challenge',$6,$7,'unique',false,$8,$9,$10)
    ON CONFLICT(id,revision) DO NOTHING`,
  [levelId, generated.ruleset, generated.title, generated.grid ?? null, generated.difficulty ?? null,
    seed, generated.generatorVersion, gameId, generated.content === undefined ? null : JSON.stringify(generated.content),
    JSON.stringify(generated.rules ?? {})])
}

/**
 * Generate any missing slots for an occurrence and persist their exact levels.
 * One failed slot never blocks the rest of the day. The occurrence is marked
 * prepared when every intended slot is ready or failed.
 */
export async function prepareOccurrence(db: Pool, occurrence: OccurrenceRow, games: readonly ChallengeGameRuntime[],
  series: SeriesRow): Promise<{ prepared: boolean; preparing: boolean }> {
  const { rows: [state] } = await db.query<{ prepared_at: Date | string | null; failed: number }>(`SELECT
      prepared_at,
      (SELECT count(*)::int FROM challenge_slots WHERE occurrence_id=$1 AND status='failed') AS failed
    FROM challenge_occurrences WHERE id=$1`, [occurrence.id])
  if (state?.prepared_at && !state.failed) return { prepared: true, preparing: false }

  // Acquire a short preparation lease. A prepared occurrence with a failed slot
  // may be retried with the same recipe; another request returns "preparing".
  const { rowCount } = await db.query(`UPDATE challenge_occurrences
    SET preparing_at=now()
    WHERE id=$1 AND (prepared_at IS NULL OR $2::boolean)
      AND (preparing_at IS NULL OR preparing_at < now() - interval '2 minutes')`,
  [occurrence.id, (state?.failed ?? 0) > 0])
  if (!rowCount) return { prepared: false, preparing: true }

  try {
    const slate = selectSlate(series, occurrence, games)
    const client = await db.connect()
    try {
      for (const item of slate) {
        await client.query(`INSERT INTO challenge_slots(
            occurrence_id,game_id,position,options,choices,rules,seed,status
          ) VALUES($1,$2,$3,$4,$5,$6,$7,'pending')
          ON CONFLICT (occurrence_id,game_id) DO NOTHING`,
        [occurrence.id, item.game.id, item.position, JSON.stringify(item.options), JSON.stringify(item.groups),
          JSON.stringify(item.rules), item.seed])
      }

      const { rows: slots } = await client.query<SlotRow>(`SELECT * FROM challenge_slots
        WHERE occurrence_id=$1 ORDER BY position`, [occurrence.id])
      for (const slot of slots) {
        if (slot.status === 'ready' || !slot.seed) continue
        const game = games.find(item => item.id === slot.game_id)
        if (!game) {
          await client.query(`UPDATE challenge_slots SET status='failed', failure_code='challenge_game_unavailable',
            updated_at=now() WHERE id=$1`, [slot.id])
          continue
        }
        try {
          const recipe: ChallengeSlotRecipe = {
            seriesId: series.id, occurrenceId: occurrence.id, periodKey: occurrence.period_key,
            game: game.id, seed: slot.seed, selection: selectionFor(slot),
          }
          const generated = await game.generate(recipe)
          await game.verify?.(generated)
          const levelId = challengeLevelId(occurrence.period_key, game.id, slot.seed)
          await persistLevel(client, levelId, game.id, slot.seed, generated)
          await client.query(`UPDATE challenge_slots SET level_id=$1,level_revision=1,generator_version=$2,
            rules=$3,status='ready',failure_code=NULL,updated_at=now() WHERE id=$4`,
          [levelId, generated.generatorVersion, JSON.stringify(generated.rules ?? {}), slot.id])
        } catch (error) {
          const code = error instanceof Error ? error.name : 'challenge_generation_failed'
          console.error(JSON.stringify({ event: 'challenge_slot_failed', slot: slot.id, game: game.id, code }))
          await client.query(`UPDATE challenge_slots SET status='failed', failure_code=$1, updated_at=now()
            WHERE id=$2`, [code, slot.id])
        }
      }

      const { rows: [remaining] } = await client.query<{ pending: number }>(`SELECT count(*)::int AS pending
        FROM challenge_slots WHERE occurrence_id=$1 AND status='pending'`, [occurrence.id])
      const prepared = (remaining?.pending ?? 0) === 0
      await client.query(`UPDATE challenge_occurrences SET preparing_at=NULL,
        prepared_at=CASE WHEN $2 THEN now() ELSE NULL END,
        failure_code=NULL WHERE id=$1`, [occurrence.id, prepared])
      return { prepared, preparing: false }
    } finally {
      client.release()
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'challenge_prepare_failed', occurrence: occurrence.id,
      code: error instanceof Error ? error.name : 'unknown' }))
    await db.query(`UPDATE challenge_occurrences SET preparing_at=NULL, failure_code='challenge_prepare_failed'
      WHERE id=$1`, [occurrence.id]).catch(() => undefined)
    return { prepared: false, preparing: false }
  }
}

