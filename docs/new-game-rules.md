# Rules for adding a game

This document is the established checklist for a new Aviarium game. It records
how the platform actually behaves, not an aspirational design. Follow it unless
the owner explicitly approves a platform change. A game that needs a new table,
a new scheduler, a resume route, or a game-id branch in a shared module is a
platform change in disguise; stop and design the missing hook instead.

Read [the game contract](game-contract.md) and
[the architecture](architecture.md#application-and-game-registration) first.
The contract is the interface; this document is the working agreement around
it.

## 1. Identity and registration

- Pick a stable lowercase id that matches `^[a-z0-9-]{1,64}$`. It is used in
  `/games/<id>`, `/api/games/<id>`, database rows, service-worker caches, and
  asset manifests. It never changes after release.
- The public id may start with a digit, but a CSS class may not. The `theme`
  value is applied as a class name, so a game id such as `2048` uses a class
  such as `twenty48-theme`, never `2048-theme`.
- The game package lives under `packages/<name>` with a private
  `@aviarium/<name>` package name. Shared game code must not import React,
  Fastify, or `pg`.
- Register the definition in **three** places:
  1. `packages/<name>/src/game.ts` exports the `GameDefinition`.
  2. `apps/server/src/game-registry.ts` adds it to
     `builtInGameDefinitions`.
  3. `apps/web/src/game-definitions.ts` adds it to `webGameDefinitions`, and
     `apps/web/src/registry.ts` adds its `WebGame` presentation.
- Add its browser entry to `apps/web/game-assets.ts`. The Vite build follows
  static imports and emits the offline asset list. Add a worker there only if
  the game actually has one.
- No platform module may name the game id. If a shared route or service needs a
  game-specific branch, add a contract hook or a flag instead.

## 2. The game owns gameplay, the platform owns the outside

The game supplies:

- `meta` (title, description, tags, e-reader/input metadata);
- the save schema, `create`, and `validate`;
- the rules schema and defaults;
- optional generation (option schema, defaults, fields, pure `generate`);
- optional leaderboard interpretation;
- optional challenge defaults and option groups;
- pack schemas, even when the game has no authored packs;
- browser `Player`, optional `Studio`, preview, and presentation copy.

The platform supplies:

- routing, library/catalog, navigation, the game menu;
- saves, local-first sync, resume, conflict copies, and the save cap;
- pack tables, revisions, publication, import/export, and progress;
- leaderboard tables, board keys, cooldowns, moderation, and avatars;
- daily-challenge series, occurrences, slots, attempts, boards, and history;
- admin settings, localization plumbing, and API error envelopes.

A game must not add a pack table, a leaderboard table, a resume route, or a
challenge scheduler.

## 3. Save and run semantics

- Every attempt is identified by `game`, `level`, `levelRevision`, `ruleset`,
  and `format`. The save also carries `elapsedMs`, `completed`, and optional
  `completedAt`.
- `completed` means **the run is finished**, not necessarily "won" or "solved".
  A game over, a loss, a puzzle solution, or a manual finish all set
  `completed: true`; the game's own fields (for example `score`, `won`,
  `reachedGoalAt`) say what kind of finish it was. This is why a game-over
  screen is a result screen, not a special platform state.
- A completed attempt is not resumable. An unfinished attempt is resumable
  until the platform's save cap archives it.
- `elapsedMs` is always recorded. The game decides whether to show a timer.
  Hidden timers still advance.
- Reset means "clear the player's input while keeping the attempt". New game
  means "create a new attempt". Do not overload one for the other.
- A game-over result must be a completed attempt. Do not leave a finished board
  as a resumable save.
- Validate the completed state on the server, not only in the browser. If a
  score can be forged, include enough information (a move log, a solution, or a
  replayable seed) for `validate` to verify it.

## 4. Seed and generation rules

- A generated level stores its `seed` and `generatorVersion` on the level.
  Reproduction must be pure and deterministic: the same seed, options, and
  generator version produce the same level on the browser, the server, and
  offline.
- The seed must reproduce **everything the player cannot choose**: the starting
  board and the order of generated content. If a game also generates content
  during play, the save must store enough state (usually a move log or a spawn
  count) to reconstruct it.
- Bump `generatorVersion` when generation changes. Old levels and saves keep
  their version and must remain readable. Do not silently change the meaning of
  an existing seed.
- A generated level is persisted once by the platform. The server may
  re-generate it on the first sync of an unknown level; the persisted content
  wins afterwards.
- Seed codes are game-owned. They should be copyable, parseable, and should
  include the generator version when old codes must keep reproducing old
  boards.
- A new game starts from a new seed. If the game offers "play this seed", make
  that an explicit secondary action.

## 5. Results, scores, and leaderboards

- One completed attempt produces one `GameResult` through
  `definition.leaderboard.result`. The platform assigns the board key; a game
  never returns a board key.
- `GameResult.unit` is `'ms'` (lower is better) or `'score'` (higher is better).
  Use `lowerIsBetter: false` for scores. Both units are stored in the same
  `leaderboard_results` table; `rank_value` already handles the direction.
- `puzzleContent` identifies the exact starting puzzle for the 30-day
  per-puzzle cooldown. It must include everything that makes the start
  different (seed, generator version, size, rules). A repeat inside 30 days is
  saved but stored as `cooldown` and hidden; it does not remove the completion.
- Boards group results by the game's settings. Quick Play boards normally group
  by difficulty/size; level boards use the exact level revision. The exact
  start is stored separately for the cooldown and for "play this board".
- A game gets **one** result row per completed attempt. If a game needs two
  independent standings from one attempt (for example a time board and a score
  board), that is a platform capability, not a reason to return two results
  from one hook. Design the platform extension first.
- Ranked results are account-scoped. Do not build a guest or device-only
  leaderboard. Personal bests are derived from the player's own attempts or from
  the leaderboard's `you` summary; they are not a second ranking system.
- Continue to use the platform moderation flow: an admin removes a result with
  a reason, the player acknowledges a once-only notice, and the completion and
  cooldown stay.

## 6. Game over and result presentation

- The platform's celebratory result shell is generic: heading, a primary value
  (time or score), optional best comparison, stats, actions, and an optional
  standings panel. A score game passes a score primary value; it must not
  pretend the score is a duration.
- A game over is not a solved puzzle. Use a "Game over" or "Run complete"
  heading unless the game actually completed its goal.
- A new personal best is a celebration-worthy event; a lower score is not. A
  loss does not need confetti.
- Reaching a milestone (for example a 2048 tile) can show a result card and
  continue the run. Do not mark the attempt complete just to show a milestone.
- The result screen must still work with the reader mode, reduced motion,
  keyboard focus, and the platform's focus trap.

## 7. Daily challenges

Daily challenges are platform-owned. There is no per-game scheduler or
per-game challenge route.

- A game is challenge-capable when it declares both `generation` and
  `leaderboard`, and has not set `challenge: false`. `GameRegistry.challengeCapable()`
  derives this; do not add a challenge adapter. Use `challenge: false` when a
  game should stay out of Daily Challenges for now even though it has a
  generator and leaderboard; 2048 does this.
- The platform builds the challenge capability with
  `challengeGameFromDefinition`. It reads:
  - `generation.options.fields` for the admin option groups;
  - `generation.options.schema` and `defaults` for generation;
  - `challenge.options` for daily defaults;
  - `challenge.optionGroups` for extra variants;
  - `generation.generate(seed, options)` and `generation.verify` for the
    exact level;
  - `leaderboard.result(...)` for the score or time.
- Adding a challenge-capable game makes it appear in the admin's registered
  games and option groups. It does **not** automatically enter the live daily
  rotation: the rotation is stored in `challenge_series.game_selections`
  (formerly `eligible_games`/`game_options`, kept for compatibility).
- The daily board writes the challenge result and, for a normal game, a second
  result on the game's normal board. The platform owns that duality.
- A score game can be selected for a challenge. The platform uses the same
  result unit; score standings are higher-is-better. The current challenge UI
  must label score boards as scores, not times.
- A game does not get a custom challenge script when its rules are unusual. Add
  an option group or a result hook; do not branch on the game id in the
  scheduler.

## 8. Packs and Studio are optional

- A game may be Quick Play-only. It still supplies pack schemas (the contract
  requires them for validation), but `packs.builtIn` may be empty and
  `WebGame.packs` may be omitted.
- A Quick Play-only game must not advertise an empty Studio. Omit the browser
  `Studio` component; the web catalog and game menu must hide authoring for
  games without one.
- If a game supports authored levels, define what a level means, provide the
  Studio editor and verification, and give every level a stable id and
  revision. Do not reuse the Quick Play level id for an authored level.
- Pack artwork, themes, chapter rules, and publication are platform features.
  Use them; do not create a parallel content model.

## 9. Presentation and theme

- The game's `theme` string is a CSS class on the game surface. Define a light
  palette, a dark palette, and a reader-mode fallback in `apps/web/src/styles.css`
  (or a game CSS file imported by the player).
- A game must remain usable in reader mode. Do not encode required information
  in color alone; use numbers, symbols, borders, or text. Reader mode also
  disables decorative motion. Shared chrome must follow the same rule: rank
  medals, current-player badges, and score chips become plain ink in reader
  mode rather than keeping their accent colors.
- Support reduced motion. Slide, merge, and pop animations are welcome, but
  must have a no-motion fallback.
- The play surface must fit the viewport from phone portrait through ultrawide
  desktop, with no page scrolling. If a game genuinely needs scrolling, say why
  in the game design doc.
- Support keyboard and touch where the input metadata says so. Keep focus
  visible, announce state changes to assistive technology, and avoid
  color-only feedback.
- Every new user-visible string goes in `apps/web/src/messages.ts` with English
  and Dutch entries. Use the shared `Message` type; do not hardcode English in
  a component if it needs translation.
- Add a library preview (a real level or a representative sample) and a
  `sample` only when the catalog needs one. A game may be a full library game
  without a hero slide.
- Library cards share one image field height. Artwork must fit that field
  instead of making its card taller. The Play action is pinned to the
  bottom-right, tags wrap in the space before it, and both sit on the card's
  lowest row. A game-specific preview may add art inside the field but must not
  change the field's height.

## 10. Offline and sync

- The service worker installs a game when it is opened. Add the player entry to
  `apps/web/game-assets.ts`; the build emits the asset list.
- Offline play uses the same save schema and the same generator. Do not add a
  second offline-only state model.
- A completion may sync later. The server verifies it with the same rules. If a
  result arrives after a challenge closes, the platform saves it but does not
  post it.
- Removing a download preserves saves. A game must not depend on a cached
  asset for save decoding.

## 11. Verification checklist

Before requesting review, a new game must have:

- unit tests for generation determinism, start board, moves/merges, score,
  game over, seed reproduction, and server rejection of forged/invalid saves;
- a registry test proving the server and web registries see the game, and that
  it is challenge-capable exactly when it should be;
- a contract smoke test through the real HTTP paths: generic Quick Play,
  progress/save, leaderboard posting, cooldown, and (if capable) a challenge
  slot;
- a browser check for keyboard and touch play, viewport fit, reload/resume,
  game over, new best, leaderboard link, offline reopen, and reader mode;
- `npm run typecheck`, `npm test`, `npm run build`, and the browser suite for
  application changes;
- a changelog fragment under `changelog.d/` for the user-visible game;
- the game design document in `docs/games/`, and any durable platform change
  recorded in `docs/architecture.md` or this document.

## 12. The short version

If you remember one rule, remember this: **the game supplies a pure, versioned
description of play; the platform supplies everything around it.** A score is
just another result unit. A game over is just a completed attempt. A daily
challenge is just another caller of the same generator. A new screen is not a
reason to add a game-id branch.
