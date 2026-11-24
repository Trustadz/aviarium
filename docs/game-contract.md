# Game contract

Status: the shared `GameDefinition`, the Sudoku and Nonograms adapters, the game
registry and a fake third-game fixture are implemented on `agent/game-platform`,
and merged with daily challenges on `agent/integration`. The server builds its
compatibility `serverGames` map from the registry and injects it into progress,
leaderboards, packs, auth, app and migration. No platform module imports a global
game map. The definitions drive packs, saves, leaderboards and generated levels
at runtime. Daily challenges derive `challengeGames` from
`GameRegistry.challengeCapable()`; the separate Sudoku/Nonograms challenge
adapters are gone. The compatibility adapter still wraps the legacy `ServerGame`
shape, and the web still consumes `WebGame`; J4/J5 remove those interfaces. The
game modules no longer own routes: the old Sudoku routes are quarantined in
`legacy-sudoku-routes.ts`, and generic `/api/games/:game/quick-play` and
`/api/games/:game/levels/:id/:revision` endpoints use the definition.

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
  - optional `verify`.
- `leaderboard` (optional) — result interpretation:
  - optional Quick Play boards;
  - optional board key/parse overrides;
  - `result(level, attempt, rules)` returning `value`, `unit`, `aids`,
    `rulesVersion`, `puzzleContent` and an optional seed code.
- `preferences` (optional) — the game's preference schema.
- `challenge` (optional) — daily defaults and future option groups. Supplying
  `generation` and a `leaderboard` is what makes the game eligible for the
  challenge scheduler.

The browser additionally supplies a `Player` and a level `Studio` component, a
preview and presentation metadata; those are the gameplay/editor surface, not
platform plumbing.

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
match. `challengeCapable()` returns games with a `generation` declaration.

A fake third-game fixture in `apps/server/src/game-registry.test.ts` is the
proof: it is discovered, becomes challenge-capable, and needs no platform edit.
The next step is to inject the registry into the pack, progress and leaderboard
modules so the fixture can exercise the real API paths.

## Adding a game

1. Create the game package with its level/attempt codecs, rules, generation,
   pack schemas and result interpretation.
2. Add the `GameDefinition` (see `packages/sudoku/src/game.ts` for the adapter
   pattern). Keep existing save formats, level ids, board keys and puzzle
   digests so old attempts and leaderboard rows stay valid.
3. Add the browser `Player`, level `Studio`, preview and presentation metadata.
4. Register the definition in the server `GameRegistry` and the browser
   `GameRegistry`; add the offline asset entries.
5. Run the game-contract tests, the parity tests and the browser suite.

No pack, leaderboard, resume, routing or challenge file should need a game-id
branch. If one does, the contract is missing a hook.

## Current gaps

- The server compatibility map is injected and definition-backed; the legacy
  `ServerGame` adapter and the web `WebGame` remain for J4/J5.
- Daily challenge inclusion is derived from `GameDefinition.generation` and
  `leaderboard`; there is no per-game challenge adapter.
- Generic Quick Play/level endpoints and the legacy Sudoku route quarantine are
  in place; removing the `/api/sudoku/*` and `/api` pack aliases is J4b.
- The web platform still consumes `WebGame`; J5 shrinks it to the contract.
- J6 turns the fixture into a package-backed proof and adds a source-scan test
  that no platform module names a game id.
