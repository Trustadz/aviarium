# Game contract

Status: the shared `GameDefinition`, the Sudoku and Nonograms adapters, the game
registry and a fake third-game fixture are implemented on `agent/game-platform`,
and merged with daily challenges on `agent/integration`. The server builds its
compatibility `serverGames` map from the registry and injects it into progress,
leaderboards, packs, auth, app and migration. No platform module imports a global
game map. The definitions drive packs, saves, leaderboards and generated levels
at runtime. Daily challenges derive `challengeGames` from
`GameRegistry.challengeCapable()`; the separate Sudoku/Nonograms challenge
adapters are gone. Effective pack rules now reach `leaderboard.result`; the dead game-specific
server modules are deleted and the pack-content test uses the definition adapter.
The compatibility adapter still wraps the legacy `ServerGame` shape. On the web, board identity, initial save creation and pack level materialization
are now derived from the shared `GameDefinition` (`game-definitions.ts`), so
`WebGame` no longer carries `leaderboards`, `createAttempt`, `history` or a
pack-level materializer. The remaining `WebGame` surface is the player/studio/presentation plus pack
presentation labels. Quick Play mutation extras now come from
`GameDefinition.generation.describe`, the level catalog uses the generic
`/api/games/:game/catalog`, and challenge replay uses the generic Quick Play
endpoint instead of per-game code. J5 continues to shrink the presentation
surface. The game modules no longer own routes: the old
Sudoku routes are quarantined in `legacy-sudoku-routes.ts`, and generic
`/api/games/:game/quick-play` and `/api/games/:game/levels/:id/:revision`
endpoints use the definition.

The target is simple: a new game supplies **gameplay and level creation**. The
platform supplies everything around it.

## What a game provides

`packages/game-sdk/src/game.ts` defines the contract. A `GameDefinition` has:

- `id` and `meta` — title, description, tags, e-reader/input metadata.
- `play` — the save codec:
  - `save.schema`, `save.create(level, context)`, `save.validate(attempt, level, context)`;
  - `rules.schema` and `rules.defaults` for the level's effective rules.
- `packs` — level materialization only:
  - pack manifest/draft/published schemas;
  - `verify(pack, prior)` for authoring checks;
  - `materialize(pack)` to level rows;
  - `sameContent(entry, rules, prior, priorRules)` for revision identity;
  - built-in packs.
- `generation` (optional) — the Quick Play/challenge generator:
  - option schema, defaults and form fields;
  - pure `generate(seed, options)`;
  - optional `materialize` for legacy generated-level ids;
  - optional `verify`;
  - optional `describe(level)` for legacy Quick Play mutation extras.
- `leaderboard` (optional) — result interpretation:
  - optional Quick Play boards;
  - optional board key/parse overrides;
  - `result(level, attempt, rules)` returning `value`, `unit`, `aids`,
    `rulesVersion`, `puzzleContent` and an optional seed code.
- `preferences` (optional) — the game's preference schema.
- `challenge` (optional) — daily defaults and future option groups. Supplying
  `generation` and a `leaderboard` is what makes the game eligible for the
  challenge scheduler.

The browser additionally supplies a `Player`, an optional level `Studio`
component, a preview and presentation metadata; those are the gameplay/editor
surface, not platform plumbing. A Quick Play-only game omits `Studio` and is
hidden from authoring.

## What the platform owns

- Routing, navigation, library/catalog and the player shell.
- Pack tables, revisions, ordering, artwork, publication, import/export and
  pack progress.
- Leaderboard tables, board keys, cooldowns, moderation, avatars and the
  after-game context.
- Saves, local-first sync, resume, conflict copies, save caps and offline cache.
- Daily-challenge series, occurrences, slot selection, attempts, boards,
  history and replay.
- Admin settings, localized messages and API error envelopes.

A game must not add its own pack table, leaderboard table, route for resume, or
challenge scheduler. It must not return a board key from a result; it returns a
`GameResult`, and the platform assigns `level:`/`quick:` or
`challenge:<slotId>`.

## Registry

`apps/server/src/game-registry.ts` builds the runtime registry:

```ts
const registry = createGameRegistry([sudokuGame, nonogramsGame])
```

`validateGameRegistry` fails startup for duplicate ids, a contract version
mismatch, a missing save contract, or a built-in pack whose game id does not
match. `challengeCapable()` returns games with both a `generation` declaration
and a leaderboard result, because daily challenges need a comparable result.

A package-backed third game in `packages/game-fixture` is the proof: it is
discovered, becomes challenge-capable, and reaches the server compatibility map
and challenge derivation without a platform edit. `createServerGames(registry)`,
`challengeGamesFromRegistry(registry)` and `makeApp(registry)` are injectable.
`tests/platform-fixture-smoke.mjs` runs the fixture through real HTTP paths:
generic Quick Play, progress/save, leaderboard board, challenge slot and
challenge board.

## Adding a game

1. Create the game package with its level/attempt codecs, rules, generation,
   pack schemas and result interpretation.
2. Add the `GameDefinition` (see `packages/sudoku/src/game.ts` for the adapter
   pattern). Keep existing save formats, level ids, board keys and puzzle
   digests so old attempts and leaderboard rows stay valid.
3. Add the browser `Player`, optional level `Studio`, preview and presentation
   metadata. Omit `Studio` for a game with no authored content.
4. Register the definition in the server `GameRegistry` and the browser
   `GameRegistry`; add the offline asset entries.
5. Run the game-contract tests, the parity tests and the browser suite.

No pack, leaderboard, resume, routing or challenge file should need a game-id
branch. If one does, the contract is missing a hook.

## Current gaps

- The server compatibility map is injected and definition-backed; the legacy
  `ServerGame` compatibility adapter remains; the web `WebGame` is now
  player/studio/presentation and pack labels. The legacy Sudoku Studio/catalog
  quarantine is the remaining routing surface.
- Daily challenge inclusion is derived from `GameDefinition.generation` and
  `leaderboard`; there is no per-game challenge adapter.
- The generic Quick Play/level endpoints are used by the web, tests and old-client
  replacements. The legacy `/api/sudoku/quick-play`, `/api/sudoku/level/*` and
  `/api` pack aliases are removed. The quarantined Sudoku Studio/catalog routes
  remain in `legacy-sudoku-routes.ts` for the old level editor until J5.
- The web still consumes `WebGame` for player/studio/presentation and pack
  presentation labels; board identity, saves, pack levels, catalog and Quick Play
  extras are platform/definition-owned.
- J6 turns the fixture into a package-backed proof and adds a source-scan test
  that no platform module names a game id.
