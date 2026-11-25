# Daily challenges

Challenges are a platform-owned, scheduled puzzle drop. **Challenges** is the
menu and page; the daily challenge is the first (and currently only) challenge
type. Aviarium owns the date, reset time, game selection, exact level
persistence, one-attempt claim, leaderboard closure, history and replay. A game
supplies its normal level generation and result interpretation; no game needs a
challenge endpoint, scheduler, leaderboard or UI.

The first release uses each game's **default rules**. Admins configure a list of
game selections in **Administration → Daily Challenge**; each selection picks a
game and the option choices available to that candidate. A game may appear more
than once with different option sets, but a day still uses each game at most
once. Pack-rule variants (hints, lives, timer, diagonal) are deliberately
deferred and remain a future option-group extension.

## Entities

- **Series** (`challenge_series`): the configured daily challenge. One row,
  `daily`, with `enabled` (default `true`), `game_limit`, `game_selections`,
  legacy `eligible_games`/`game_options` compatibility fields, `timezone`,
  `reset_minute`, and a generation version. `game_selections` is the list of
  repeatable `{ game, options }` candidates.
- **Occurrence** (`challenge_occurrences`): one local day, `period_key`
  (`YYYY-MM-DD`), absolute `starts_at`/`ends_at`, a timezone/reset snapshot, a
  random seed, and a `settings` snapshot (including game selections) so later
  admin changes cannot reshuffle a day that is already prepared.
- **Slot** (`challenge_slots`): one game in the occurrence. Exactly one slot per
  game per day. It stores the chosen options/choices, the slot seed, and the
  exact `published_levels` revision (`source='Challenge'`,
  `catalog_visible=false`). With X=2 the current Sudoku and Nonograms slots
  appear as compact rows. Each row uses the same game-preview component as the
  library cards, on the theme gradient, then the game title and top three
  times. Completed slots move to a separate **Completed** section at the bottom.
- **Attempt** (`challenge_attempts`): one player's claim. `session_id` is the
  server-issued save id; `(slot_id, owner_id)` is unique.
- **Result** (`leaderboard_results`): one row per completed attempt,
  `board_kind='challenge'`, `board_key='challenge:<slotId>'`, and
  `challenge_slot_id`/`challenge_attempt_id`. The challenge row never uses the
  general 30-day cooldown; a matching normal game row is written alongside it.

## Time and reset

- `TZ` sets the instance-wide IANA timezone. Compose defaults it to `UTC`;
  a source checkout uses the process/system timezone when it is unset.
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
  challenge leaderboard; the client is told the run was not ranked.
- The client posts the verified completion as soon as the attempt is saved,
  rather than waiting for navigation. The after-game standings and **View
  leaderboard** therefore show the run without a refresh, and a completion
  near the reset is received as early as possible.
- Running out of lives (when a future rules variant enables them) or an invalid
  completion closes the attempt without a result.
- Challenge levels are hidden from the catalog, Studio and published-puzzles
  list. The client refuses to open a `source='Challenge'` level as normal
  practice; the server rejects it with `challenge_required`. A completed
  challenge still writes a normal game result on the matching Quick Play
  difficulty/size board, using the challenge's actual rules.

## Challenge leaderboards and closure

- One challenge leaderboard per occurrence + game. It is open only during
  `[starts_at, ends_at)`; after reset it is read-only.
- A verified completion writes **two** result rows for the same save: the
  challenge row (`board_kind='challenge'`) and the normal game row on the
  matching Quick Play difficulty/size board. The game row carries the same
  authoritative time, aids, rules version and board metadata; the challenge
  row remains excluded from general summaries.
- Standings show the best active result per account (one result per account in a
  challenge), tie ranks, avatars for the top three and the viewer, and the
  viewer's own row when it falls outside the visible list. The after-game
  modal separates the top three from the viewer neighbourhood with a dashed
  divider, so a jump from rank 3 to rank 7 is not mistaken for consecutive
  ranks. The current player is highlighted in every leaderboard table and mini
  list.
- The challenge summary/hub returns a **replay descriptor** for past slots:
  `{ game, seed, options, rules, generatorVersion }`. **Play this game** launches
  a normal Quick Play/generated game, not a new challenge attempt. Its result
  posts to the normal general board under the existing rules, not to the closed
  daily board.
- The daily board closes when the next one starts. Replaying a seed opens a normal
game with a replay banner and a Back to challenge path. There is no ranked replay of
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
| `GET /api/challenges/:occurrenceId/slots/:gameId/board?limit=20` | Dedicated challenge leaderboard. Returns `board`, `slot`, `top`, `you`, `total`, `serverNow`. No seed/All records/Play-this-board. |
| `GET /api/challenges/history?before=&limit=20` | Past occurrences, newest first; final top 3, viewer status, replay descriptors. Used by the "Yesterday" link, the Leaderboards **Challenges** tab and the past list. |
| `POST /api/challenges/slots/:slotId/start` | Claim/resume while open. Returns `attemptId`, `sessionId`, `startedAt`, `resumed`, occurrence, slot level/options/rules and (on resume) the server save. Errors: `challenge_closed`, `challenge_disabled`, `challenge_already_completed`, `challenge_slot_unavailable`, `challenge_game_unsupported`. |
| `POST /api/progress` | Existing save sync plus optional `challenge: { attemptId }`. Verifies the attempt, writes the challenge result and the matching normal game result, and returns `challenge: { attemptId, status, ranked, invalid? }`. A general mutation for a `source='Challenge'` level is rejected with `challenge_required`. |
| `GET /api/challenges/games` | Registered challenge-capable games and their option groups. Used by admin/discovery; not required by the player UI. |
| `GET /api/admin/challenges/settings` | Series settings, registered games/options, current/next occurrence, `appliesFrom`, minimum window. |
| `PATCH /api/admin/challenges/settings` | Enable/disable, reset minute, game limit and repeatable game selections (`{ game, options }`). Legacy eligible-games/options payloads are accepted for compatibility. `expectedUpdatedAt` guards two-admin edits. Changes apply to the next occurrence. |
| `POST /api/admin/challenges/generate` | **Test environments only.** Applies the current settings to the current occurrence, replaces its attempts/slots and generates new levels. Returns 404 outside `TEST_ENVIRONMENT=true`. |

`GET /api/challenges/summary` returns `200 { enabled: false }` when the feature
is disabled; the nav hides the destination. `CHALLENGES_ENABLED=false` is an
emergency kill switch; the database `enabled` flag is the graceful pause that
still allows in-flight completions.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TZ` | process timezone | IANA timezone for daily boundaries. Compose defaults to `UTC`; invalid values fail startup. |
| `CHALLENGES_ENABLED` | `true` | Emergency kill switch. Set `false` to stop scheduling and writes. |

The reset minute, enabled state, game selections and game limit are admin
settings in the database. `TZ` and `CHALLENGES_ENABLED` are environment
settings.

## Administration

**Administration → Daily Challenge** provides:

- enable/disable;
- games per day;
- repeatable **game selections** in a dedicated **Game content** panel: use
  **Add game selection** to choose a game, its generation choices and its
  game-setting choices, and add the same game again for a different option set
  (for example Nonograms 5 × 5 with Easy/Medium/Hard and Nonograms 10 × 10 with
  Easy/Medium, or Sudoku Medium with Auto notes off and Easy with Auto notes on).
  The same game is still used at most once per day. Added selections are shown
  as compact rows with their settings and a Remove action only;
- reset time as 24-hour hour/minute selects;
- read-only timezone from the environment, rendered as static text rather than
  an input;
- the global **Enable daily challenges** toggle at the top (default on); turning
  it off removes the **Challenges** menu item;
- current/next occurrence status.

The scheduler follows four steps:

1. create `games per day` slots;
2. assign distinct games to the slots;
3. choose one configured selection profile for each game, then one enabled value
   for each option group;
4. generate the resulting levels deterministically from the occurrence seed so
   every player receives the same puzzles.

Administration is organized into **Backups**, **Users**, **Leaderboards**,
**Packs** and **Daily Challenge** tabs.

There is no challenge editor and no manual prepare action. Puzzle content is
generated from the game and selected options; an admin cannot pin or author a
daily puzzle. In production, settings changes apply from the next occurrence. A
test environment additionally exposes **Generate new daily challenges**, which
applies the current settings and replaces the current occurrence so generation
can be exercised end to end.

## First-release scope and deferred work

Shipped in this slice: Sudoku and Nonograms daily challenges, X 1–2 with one
slot per game, one attempt, input-only reset, closed-at-reset challenge leaderboards,
after-game challenge standings, nav/badge with the count on the top-right of
the calendar icon (including the sidebar), **Challenges** naming, compact daily
rows using the library game-preview component with the theme gradient and
top-three times, a **Completed** section at the bottom, an all-completed
message with a flat parrot that works in light, dark and e-reader modes, the
first unresolved daily challenge as the first **Continue** card with a calendar
badge, **Play this game** replay of a closed seed to the general leaderboard,
the Leaderboards **General | Challenges** tabs with the search below the tabs
and tab-style underline controls, a meta countdown in place of the reset label,
both challenge and normal-game leaderboard results, the Leaderboards a current-day and paginated past list, all-mode
after-game standings on the played level's board with a secondary
pack-leaderboard link, server-authoritative challenge times (the server start
time is a floor and time away counts), games-in-rotation admin controls,
English/Dutch, mobile and offline/error states. Starting a run no longer shows a
confirmation alert or one-attempt/timed-run copy; the server still enforces one
attempt. Challenge rows have no separate leaderboard button: the top-three
**and N more** link opens the leaderboard, and the after-game modal keeps a
**View leaderboard** action. There is no **Play the other challenge** button.
Every leaderboard view highlights the current player.

Challenge results for time-based games use the server start time as a floor for
both the challenge row and the matching game row: a completion cannot post a
faster time than the wall clock allowed, so leaving and resuming cannot reduce
the recorded time.

Deferred: the secondary pack aggregate panel; pack-rule variants
(hints/Auto notes/lives/timer/diagonal); admin recovery UI; per-game custom
challenge profiles; rank-gap separators and tab keyboard/roving-focus polish;
offline sync retry.

## Verification

- Unit: timezone/DST matrix; navigation trails; save reset helpers.
- Manual API checks: two accounts see the same level; concurrent start returns
  one attempt; a second start after completion is rejected; late completion is
  saved but not posted; duplicate sync is idempotent; the challenge level is
  rejected by a normal progress mutation; challenge rows do not affect general
  cooldowns, player summaries or the busiest board; a challenge completion also
  appears on the matching Quick Play board with the right difficulty/size. The browser suite now runs
  `tests/challenges-smoke.mjs`, which covers two slots, one claim, the second
  start rejection, the server time floor, a late close, history, replay, the
  nav badge using the test clock, and that **View leaderboard** waits for a
  delayed completion post before showing the player's row.
- Manual browser: nav/badge, today/day/closed/replay, start/resume, input-only reset,
  leaderboard, after-game panel, Continue daily card, Completed section,
  admin settings, en/nl, 360/393/200%, offline/error states.
- Existing suites: `npm run typecheck`, `npm test`, `npm run build`,
  `npm run test:browser` against disposable PostgreSQL.
