# Daily challenges

Daily challenges are a platform-owned, scheduled puzzle drop. Aviarium owns the
date, reset time, game selection, exact level persistence, one-attempt claim,
leaderboard closure, history and replay. A game supplies its normal level
generation and result interpretation; no game needs a challenge endpoint,
scheduler, board or UI.

The first release uses each game's **default rules** and a fixed challenge
profile (Sudoku Medium). Enabled difficulty options can be narrowed in
**Administration → Challenge settings**; pack-rule variants (hints, lives,
timer, diagonal) are deliberately deferred and remain a future option-group
extension.

## Entities

- **Series** (`challenge_series`): the configured daily challenge. One row,
  `daily`, with `enabled`, `game_limit`, `eligible_games`, `game_options`,
  `timezone`, `reset_minute`, and a generation version.
- **Occurrence** (`challenge_occurrences`): one local day, `period_key`
  (`YYYY-MM-DD`), absolute `starts_at`/`ends_at`, a timezone/reset snapshot, a
  random seed, and a `settings` snapshot so later admin changes cannot reshuffle
  a day that is already prepared.
- **Slot** (`challenge_slots`): one game in the occurrence. Exactly one slot per
  game per day. It stores the chosen options/choices, the slot seed, and the
  exact `published_levels` revision (`source='Challenge'`,
  `catalog_visible=false`). With X=2 the current Sudoku and Nonograms slots
  appear as separate cards and boards.
- **Attempt** (`challenge_attempts`): one player's claim. `session_id` is the
  server-issued save id; `(slot_id, owner_id)` is unique.
- **Result** (`leaderboard_results`): one row per completed attempt,
  `board_kind='challenge'`, `board_key='challenge:<slotId>'`, and
  `challenge_slot_id`/`challenge_attempt_id`. Challenge results never use the
  general 30-day cooldown.

## Time and reset

- `CHALLENGE_TIMEZONE` sets the instance-wide IANA timezone (default `UTC`).
- The admin picks the reset minute (00:00–23:59 local). It is stored in
  `challenge_series.reset_minute`.
- The occurrence label is the local date of the start boundary. A 04:00
  challenge starting 24 November is the 24 November challenge at 02:00 on
  25 November.
- DST: a reset time in a spring-forward gap resolves to the first valid instant
  after the gap; a repeated fall-back time resolves to the earlier instant.
  Day lengths are 23 or 25 hours where applicable. The pure helper lives in
  `apps/server/src/challenges/time.ts` and has a UTC/Amsterdam/New York/
  Kolkata/Chatham/Lord Howe test matrix.
- A day is not created when less than 120 minutes remain. Enabling late shows
  the next reset instead.

## Play lifecycle

- `POST /api/challenges/slots/:slotId/start` claims the attempt while the
  occurrence is open. It is idempotent: a second tab/device receives the same
  server-issued session and level, with `resumed: true`.
- The client creates a local save whose id is the returned `sessionId`, tags it
  with the attempt, and uses the normal game player.
- One attempt per game/day. There is no second attempt and no timer reset.
- The board reset action clears the input only. It preserves elapsed time,
  lives, aids, the attempt id and the level/pack revisions. The timer continues.
- A completion posts only if the server verifies and receives it before
  `ends_at`. Late or offline completions are saved but not posted to the closed
  challenge board; the client is told the run was not ranked.
- Running out of lives (when a future rules variant enables them) or an invalid
  completion closes the attempt without a result.
- Challenge levels are hidden from the catalog, Studio, published-puzzles list
  and general boards. The client refuses to open a `source='Challenge'` level as
  normal practice; the server rejects it with `challenge_required`.

## Challenge boards and closure

- One board per occurrence + game. The board is open only during
  `[starts_at, ends_at)`; after reset it is read-only.
- Standings show the best active result per account (one result per account in a
  challenge), tie ranks, avatars for the top three and the viewer, and the
  viewer's own row when it falls outside the visible list.
- The challenge summary/hub returns a **replay descriptor** for past slots:
  `{ game, seed, options, rules, generatorVersion }`. "Play this seed" launches
  a normal Quick Play/generated game, not a new challenge attempt. Its result
  posts to the normal general board under the existing rules (including the
  30-day exact-puzzle cooldown), not to the closed daily board.
- The daily board closes when the next one starts. There is no ranked replay of
  a past daily board.

## API

All player routes require an account. Admin routes require the Admin role.
Write requests still require the configured origin. API responses are
`no-store`.

| Route | Purpose |
| --- | --- |
| `GET /api/challenges/summary` | Badge/nav payload: `enabled`, `open`, `serverNow`, current occurrence, series, `nextStart`. Cheap; no full hub. |
| `GET /api/challenges` | Today's hub: occurrence, slots (exact level, options, player status, top 3/you), open count. |
| `GET /api/challenges/:occurrenceId` | Day detail for the current or a past occurrence: slots, final standings, replay descriptors. Future occurrences 404. |
| `GET /api/challenges/:occurrenceId/slots/:gameId/board?limit=20` | Dedicated challenge board. Returns `board`, `slot`, `top`, `you`, `total`, `serverNow`. No seed/All records/Play-this-board. |
| `GET /api/challenges/history?before=&limit=20` | Past occurrences, newest first; final top 3, viewer status, replay descriptors. Used by the "Yesterday" link, the Leaderboards **Challenges** tab and the past list. |
| `POST /api/challenges/slots/:slotId/start` | Claim/resume while open. Returns `attemptId`, `sessionId`, `startedAt`, `resumed`, occurrence, slot level/options/rules and (on resume) the server save. Errors: `challenge_closed`, `challenge_disabled`, `challenge_already_completed`, `challenge_slot_unavailable`, `challenge_game_unsupported`. |
| `POST /api/progress` | Existing save sync plus optional `challenge: { attemptId }`. Verifies the attempt, writes one challenge result, and returns `challenge: { attemptId, status, ranked, invalid? }`. A general mutation for a `source='Challenge'` level is rejected with `challenge_required`. |
| `GET /api/challenges/games` | Registered challenge-capable games and their option groups. Used by admin/discovery; not required by the player UI. |
| `GET /api/admin/challenges/settings` | Series settings, registered games/options, current/next occurrence, `appliesFrom`, minimum window. |
| `PATCH /api/admin/challenges/settings` | Enable/disable, reset minute, game limit, eligible games, and per-game option values. `expectedUpdatedAt` guards two-admin edits. Changes apply to the next occurrence. |
| `POST /api/admin/challenges/prepare` | Force ensure/prepare today (or a `periodKey`) and return diagnostics. Retries failed slots with the same recipe; it is not an editor. |

`GET /api/challenges/summary` returns `200 { enabled: false }` when the feature
is disabled; the nav hides the destination. `CHALLENGES_ENABLED=false` is an
emergency kill switch; the database `enabled` flag is the graceful pause that
still allows in-flight completions.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHALLENGE_TIMEZONE` | `UTC` | IANA timezone for daily boundaries. Invalid values fail startup. |
| `CHALLENGES_ENABLED` | `true` | Emergency kill switch. Set `false` to stop scheduling and writes. |

The reset minute, enabled state, difficulty options, eligible games and game
limit are admin settings in the database.

## Administration

**Administration → Challenge settings** provides:

- enable/disable;
- games per day (1–2 with the current eligible games);
- reset time as 24-hour hour/minute selects;
- read-only timezone from the environment;
- per-game enabled generation options (Sudoku difficulties; Nonograms grid size
  and difficulties);
- current/next occurrence status and **Prepare now**.

There is no challenge editor. Puzzle content is generated from the game and the
enabled options; an admin cannot pin or author a daily puzzle.

## First-release scope and deferred work

Shipped in this slice: Sudoku and Nonograms daily challenges, X 1–2 with one
slot per game, one attempt, input-only reset, closed-at-reset challenge boards,
after-game challenge standings, nav/badge, minimal admin settings, replay seed
to the general board, the Leaderboards **General | Challenges** tabs, a
current-day and paginated past list, all-mode after-game standings on the played
level's board (Quick Play and packs), English/Dutch, mobile and offline/error
states.

Deferred: the secondary pack aggregate panel; pack-rule variants (hints/Auto
notes/lives/timer/diagonal); admin recovery UI; per-game custom challenge
profiles; first-class replay context; authoritative wall-clock timing.

## Verification

- Unit: timezone/DST matrix; navigation trails; save reset helpers.
- Manual API checks: two accounts see the same level; concurrent start returns
  one attempt; a second start after completion is rejected; late completion is
  saved but not posted; duplicate sync is idempotent; the challenge level is
  rejected by a normal progress mutation; challenge rows do not affect general
  cooldowns, player summaries or the busiest board. A repeatable automated
  lifecycle test is still on the J6 list.
- Manual browser: nav/badge, today/day/closed/replay, start/resume, input-only reset,
  challenge board, after-game panel, admin settings, en/nl, 360/393/200%,
  offline/error states.
- Existing suites: `npm run typecheck`, `npm test`, `npm run build`,
  `npm run test:browser` against disposable PostgreSQL.
