import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addCivilDays, formatPeriodKey, localBoundary, nextOccurrenceStart, occurrenceFor, offsetMs,
  parsePeriodKey, validTimeZone, zoneParts,
} from './challenges/time.js'

const at = (iso: string) => Date.parse(iso)
const hour = 60 * 60 * 1000

test('normal local reset times across ordinary offsets', () => {
  assert.equal(localBoundary({ year: 2026, month: 11, day: 25 }, 4 * 60, 'Europe/Amsterdam'),
    at('2026-11-25T03:00:00Z'))
  assert.equal(localBoundary({ year: 2026, month: 11, day: 25 }, 4 * 60, 'America/New_York'),
    at('2026-11-25T09:00:00Z'))
  assert.equal(localBoundary({ year: 2026, month: 11, day: 25 }, 4 * 60, 'Asia/Kolkata'),
    at('2026-11-24T22:30:00Z'))
  assert.equal(localBoundary({ year: 2026, month: 11, day: 25 }, 4 * 60, 'UTC'),
    at('2026-11-25T04:00:00Z'))
})

test('spring-forward gaps resolve to the first valid instant after the gap', () => {
  // New York skips 02:00-02:59 on 2026-03-08. 02:30 becomes 03:00 EDT.
  assert.equal(localBoundary({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, 'America/New_York'),
    at('2026-03-08T07:00:00Z'))
  // Amsterdam skips 02:00-02:59 on 2026-03-29. 02:30 becomes 03:00 CEST.
  assert.equal(localBoundary({ year: 2026, month: 3, day: 29 }, 2 * 60 + 30, 'Europe/Amsterdam'),
    at('2026-03-29T01:00:00Z'))
  // Lord Howe shifts by 30 minutes. 02:15 becomes 02:30 LHDT.
  assert.equal(localBoundary({ year: 2026, month: 10, day: 4 }, 2 * 60 + 15, 'Australia/Lord_Howe'),
    at('2026-10-03T15:30:00Z'))
  // Chatham shifts by an hour at 02:45. A requested 03:00 becomes 03:45 CHADT.
  assert.equal(localBoundary({ year: 2026, month: 9, day: 27 }, 3 * 60, 'Pacific/Chatham'),
    at('2026-09-26T14:00:00Z'))
})

test('fall-back repeats resolve to the earlier occurrence', () => {
  // New York repeats 01:00-01:59 on 2026-11-01. 01:30 EDT is the earlier one.
  assert.equal(localBoundary({ year: 2026, month: 11, day: 1 }, 1 * 60 + 30, 'America/New_York'),
    at('2026-11-01T05:30:00Z'))
  // Amsterdam repeats 02:00-02:59 on 2026-10-25. 02:30 CEST is the earlier one.
  assert.equal(localBoundary({ year: 2026, month: 10, day: 25 }, 2 * 60 + 30, 'Europe/Amsterdam'),
    at('2026-10-25T00:30:00Z'))
})

test('a DST day is 23 or 25 hours long, not always 24', () => {
  const spring = occurrenceFor(at('2026-03-08T12:00:00Z'), 'America/New_York', 0)
  assert.equal(spring.periodKey, '2026-03-08')
  assert.equal(spring.startsAt, at('2026-03-08T05:00:00Z'))
  assert.equal(spring.endsAt, at('2026-03-09T04:00:00Z'))
  assert.equal(spring.endsAt - spring.startsAt, 23 * hour)

  const fall = occurrenceFor(at('2026-11-01T12:00:00Z'), 'America/New_York', 0)
  assert.equal(fall.periodKey, '2026-11-01')
  assert.equal(fall.startsAt, at('2026-11-01T04:00:00Z'))
  assert.equal(fall.endsAt, at('2026-11-02T05:00:00Z'))
  assert.equal(fall.endsAt - fall.startsAt, 25 * hour)
})

test('the occurrence label is the local date of the start boundary', () => {
  const beforeReset = occurrenceFor(at('2026-11-25T02:00:00Z'), 'Europe/Amsterdam', 4 * 60)
  assert.equal(beforeReset.periodKey, '2026-11-24')
  assert.equal(beforeReset.startsAt, at('2026-11-24T03:00:00Z'))
  assert.equal(beforeReset.endsAt, at('2026-11-25T03:00:00Z'))

  const atReset = occurrenceFor(at('2026-11-25T03:00:00Z'), 'Europe/Amsterdam', 4 * 60)
  assert.equal(atReset.periodKey, '2026-11-25')
  assert.equal(atReset.startsAt, at('2026-11-25T03:00:00Z'))
  assert.equal(atReset.endsAt, at('2026-11-26T03:00:00Z'))
})

test('nextOccurrenceStart moves to the next reset after the boundary', () => {
  assert.equal(nextOccurrenceStart(at('2026-11-25T02:59:59Z'), 'Europe/Amsterdam', 4 * 60),
    at('2026-11-25T03:00:00Z'))
  assert.equal(nextOccurrenceStart(at('2026-11-25T03:00:00Z'), 'Europe/Amsterdam', 4 * 60),
    at('2026-11-26T03:00:00Z'))
})

test('period keys round-trip without local timezone drift', () => {
  assert.deepEqual(parsePeriodKey('2026-11-25'), { year: 2026, month: 11, day: 25 })
  assert.equal(parsePeriodKey('2026-02-30'), undefined)
  assert.equal(parsePeriodKey('25-11-2026'), undefined)
  assert.equal(formatPeriodKey({ year: 2026, month: 1, day: 2 }), '2026-01-02')
  assert.deepEqual(addCivilDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 })
})

test('zone helpers use the requested zone, not the host zone', () => {
  assert.deepEqual(zoneParts(at('2026-11-25T03:00:00Z'), 'Europe/Amsterdam'),
    { year: 2026, month: 11, day: 25, hour: 4, minute: 0, second: 0 })
  assert.equal(offsetMs(at('2026-11-25T03:00:00Z'), 'Europe/Amsterdam'), 1 * hour)
  assert.equal(offsetMs(at('2026-11-25T03:00:00Z'), 'UTC'), 0)
  assert.equal(validTimeZone('Europe/Amsterdam'), true)
  assert.equal(validTimeZone('Not/AZone'), false)
})

test('invalid reset minutes fail loudly', () => {
  assert.throws(() => localBoundary({ year: 2026, month: 11, day: 25 }, -1, 'UTC'))
  assert.throws(() => localBoundary({ year: 2026, month: 11, day: 25 }, 1440, 'UTC'))
  assert.throws(() => localBoundary({ year: 2026, month: 11, day: 25 }, 1.5, 'UTC'))
})
