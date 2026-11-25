/**
 * Zoned daily boundaries for challenges.
 *
 * The app stores absolute instants, but a daily challenge is defined by a
 * local wall-clock reset time in an IANA timezone. These helpers convert
 * between the two without adding a date library, and deliberately handle the
 * two DST cases:
 *
 * - a reset time inside a spring-forward gap resolves to the first valid
 *   instant after the gap (for example, 02:30 -> 03:00);
 * - a reset time that occurs twice on a fall-back day resolves to the earlier
 *   instant.
 *
 * Nothing here reads the current clock. Callers pass `now` so the scheduler and
 * tests share one injectable time source.
 */

export interface CivilDate {
  year: number
  month: number
  day: number
}

export interface ZonedParts extends CivilDate {
  hour: number
  minute: number
  second: number
}

export interface OccurrenceWindow {
  /** Local date of the start boundary, used as the stable occurrence key. */
  periodKey: string
  /** Inclusive start instant, milliseconds since the Unix epoch. */
  startsAt: number
  /** Exclusive end instant, milliseconds since the Unix epoch. */
  endsAt: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    formatters.set(timeZone, value)
  }
  return value
}

/** True when the runtime accepts the IANA timezone name. */
export function validTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

/** Civil clock parts for an instant in a zone. */
export function zoneParts(instant: number, timeZone: string): ZonedParts {
  const values: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  }
}

/** The zone's UTC offset in milliseconds at an instant. */
export function offsetMs(instant: number, timeZone: string): number {
  const parts = zoneParts(instant, timeZone)
  // Intl reports whole seconds. Align the instant to the same second so the
  // result is the actual zone offset, not a sub-second remainder that would
  // break the transition search below.
  const wholeSecond = Math.floor(instant / 1000) * 1000
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - wholeSecond
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

export function sameCivilDate(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** `YYYY-MM-DD` for storage, sorting and the API. */
export function formatPeriodKey(date: CivilDate): string {
  return String(date.year).padStart(4, '0') + '-' + String(date.month).padStart(2, '0') + '-' + String(date.day).padStart(2, '0')
}

/** Parse `YYYY-MM-DD` without going through the local timezone. */
export function parsePeriodKey(key: string): CivilDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const normalized = addCivilDays(date, 0)
  return sameCivilDate(date, normalized) ? date : undefined
}

function atLocalMinute(instant: number, date: CivilDate, minuteOfDay: number, timeZone: string): boolean {
  const parts = zoneParts(instant, timeZone)
  return sameCivilDate(parts, date) && parts.hour * 60 + parts.minute === minuteOfDay
}

function firstInstantWithNewOffset(lo: number, hi: number, timeZone: string): number {
  const startOffset = offsetMs(lo, timeZone)
  let left = lo
  let right = hi
  // One-second resolution is enough for a wall-clock minute boundary.
  while (right - left > 1000) {
    const middle = left + Math.floor((right - left) / 2)
    if (offsetMs(middle, timeZone) === startOffset) left = middle
    else right = middle
  }
  // The transition is at a whole second. The binary search can land anywhere
  // inside the first second with the new offset, so snap down to its start.
  return Math.floor(right / 1000) * 1000
}

/**
 * The instant at which the local clock first reads `minuteOfDay` on `date`.
 *
 * Spring-forward: if the wall clock skips the requested minute, the first
 * valid instant after the gap is returned (for example, 03:00 for a requested
 * 02:30). Fall-back: if the wall clock repeats the requested minute, the
 * earlier occurrence is returned.
 */
export function localBoundary(date: CivilDate, minuteOfDay: number, timeZone: string): number {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439)
    throw new Error('minuteOfDay must be an integer from 0 to 1439')
  const target = Date.UTC(date.year, date.month - 1, date.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60)
  const sixHours = 6 * 60 * 60 * 1000
  // The first offset guess may already be the answer. Sample around that
  // guess rather than around the naive UTC target, because a large positive
  // offset can put the transition many hours before the naive target.
  const guess = target - offsetMs(target, timeZone)
  const beforeOffset = offsetMs(guess - sixHours, timeZone)
  const afterOffset = offsetMs(guess + sixHours, timeZone)
  const candidates = [target - beforeOffset, target - afterOffset].filter((instant, index, all) =>
    all.indexOf(instant) === index)
  const valid = candidates.filter(instant => atLocalMinute(instant, date, minuteOfDay, timeZone))
  if (valid.length) return Math.min(...valid)

  // The requested local minute is in a spring-forward gap. The first valid
  // instant after the gap is the instant the offset changes.
  const lo = guess - sixHours
  const hi = guess + sixHours
  if (offsetMs(lo, timeZone) === offsetMs(hi, timeZone))
    throw new Error('Could not resolve the local boundary for ' + timeZone + ' on ' + formatPeriodKey(date))
  return firstInstantWithNewOffset(lo, hi, timeZone)
}

/**
 * The occurrence containing `now` for a daily series with the given reset time.
 * Intervals are half-open: `[startsAt, endsAt)`.
 */
export function occurrenceFor(now: number, timeZone: string, resetMinute: number): OccurrenceWindow {
  const local = zoneParts(now, timeZone)
  const today: CivilDate = { year: local.year, month: local.month, day: local.day }
  const todayStart = localBoundary(today, resetMinute, timeZone)
  const startDate = now < todayStart ? addCivilDays(today, -1) : today
  const startsAt = localBoundary(startDate, resetMinute, timeZone)
  const endsAt = localBoundary(addCivilDays(startDate, 1), resetMinute, timeZone)
  return { periodKey: formatPeriodKey(startDate), startsAt, endsAt }
}

/** The next occurrence start strictly after `now` (for "starts at" states). */
export function nextOccurrenceStart(now: number, timeZone: string, resetMinute: number): number {
  const current = occurrenceFor(now, timeZone, resetMinute)
  return current.startsAt > now ? current.startsAt :
    localBoundary(addCivilDays(parsePeriodKey(current.periodKey)!, 1), resetMinute, timeZone)
}
