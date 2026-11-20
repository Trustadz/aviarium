# Aviarium architecture

## Game registration

The web registry in `apps/web/src/registry.ts` exposes lightweight metadata and a lazy player loader. Sudoku ruleset 1 is used by the player, API completion verification, and the server puzzle worker. The current API and PWA routes are explicitly bound to Sudoku. When a second game is approved, add its registered ruleset, content codecs, optional creator tools, route, and asset graph alongside Sudoku. A game supplies its own validation semantics and rendering technology.

## Levels and checks

Givens are 81 row-major digits. Zero means empty. A draft can be edited without affecting published revisions. The generation job records a seed and generator version. Validation jobs capture the draft revision and return one of invalid, unsolvable, unique, multiple, or inconclusive. The app processes the PostgreSQL job queue after startup. A bounded worker thread runs the solver off the HTTP event loop. The job lease survives browser close and app restart. An expired search budget is inconclusive. Publishing requires a successful test of the current draft. Published data is immutable and the newest revision of each ID forms the shared catalog. Previous revisions remain available for saved attempts. Admins can hide an editor’s publication from the catalog while retaining its saved attempts. Users can play every published game. Editing access is granted by game ID and checked by the server. Admins have editing access across the library.

Difficulty v1 classifies puzzles solved with naked singles as Easy, puzzles that also use hidden singles as Medium, and puzzles that need search beyond those techniques as Hard. This gives a stable grade but a broad Hard category. A server search witness provides a labeled fallback step for solution playback. Generated grids are checked for their requested difficulty and uniqueness policy. The default is unique.

## Saves and offline storage

The Sudoku save envelope identifies game, level ID and revision, ruleset, and save format. It includes entries, note masks, bounded undo/redo, elapsed time, and completion. Dexie saves the latest local state and pending upload. Server mutations are idempotent by UUID. A stale base revision creates a separate attempt rather than overwriting the server snapshot. Verified completion is stored independently of individual attempts.

Foreground sync runs when an authenticated player visits the library, returns to the foreground, or reconnects. Active play checkpoints locally until returning to the library or puzzle list. Account identity is checked on authorization-sensitive sync requests. Synced preferences merge field updates. Theme and e-reader mode are device-local. Games use the device's light or dark mode with their own palettes. Sudoku's timer, hints, and conflict highlighting are controlled from the Sudoku menu. The library and catalog endpoint require an account. Saves and the synchronization queue are keyed by account ID.

The production service worker caches the shell and downloadable player assets. The catalog stores exact puzzles with the versioned save reference. Download Sudoku from the puzzle list for offline startup. While offline, the browser can reopen downloaded puzzles until its last verified session expires. Signing out clears the cached session. API and authentication traffic stay network-only.

## Current scope

The platform ships Sudoku, player accounts and roles, draft review and publishing, local and server progress, and scheduled PostgreSQL backups. Personal or competitive ranking, daily schedules, other games, and rich media packs require their own game milestones. The platform accepts any valid completed grid for explicitly multi-solution publications.
