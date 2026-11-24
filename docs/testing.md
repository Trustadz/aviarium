# Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Core tests cover the solver outcomes, difficulty, generated puzzle reproducibility, move rules, leaderboard board grouping and cooldowns, and backup settings.

For a local Compose smoke test, install Chromium or run `npx playwright install chromium`. Set `AVIARIUM_CHROMIUM` if using a system Chromium executable. Set `AVIARIUM_TEST_URL` to the local running app. The script defaults to `http://localhost:4183`. Point it at a disposable deployment. It creates draft, job, save, and publication records when administrator and player fixtures are supplied.

`npm run test:smoke` tests the signed-out gate, touch and keyboard controls, undo/redo, pause, e-reader, offline reload, and starting random or seeded Quick Play puzzles offline and syncing them on reconnect. Set `AVIARIUM_TEST_PLAYER` or `AVIARIUM_TEST_ADMIN` to a raw session cookie for a test account. Supply both for server permissions and privileged-browser coverage. Set `AVIARIUM_TEST_BACKUPS=1` to also exercise Run now and rolling retention in a smoke subfolder. `AVIARIUM_SCREENSHOTS` can name an existing directory for browser screenshots.

For leaderboards, use two player accounts and an admin on one instance. Complete two different Quick Play seeds of the same difficulty and a pack level, then confirm both difficulty results appear, the seed's **Play this board** action opens the exact grid, and the pack level has its own board. Replay the same exact puzzle inside 30 days and confirm the replay is saved but does not replace the visible time; start a different puzzle and confirm it posts immediately. Remove a player's best result as an admin and confirm the next active time appears, the player sees the reason once across devices, and completion history and the cooldown remain. Run the standalone leaderboard test with `AVIARIUM_TEST_URL`, `AVIARIUM_TEST_ADMIN`, `AVIARIUM_TEST_PLAYER`, `AVIARIUM_TEST_PLAYER2`, and `AVIARIUM_TEST_DATABASE_URL` when debugging outside the combined runner.
To fill a disposable instance through the real API, run `AVIARIUM_TEST_URL=http://... npm run seed:leaderboards` (optional `AVIARIUM_SEED_USERS`, `AVIARIUM_SEED_PER_BOARD`, `AVIARIUM_SEED_DAYS`, `AVIARIUM_SEED_RANDOM`, and `AVIARIUM_TEST_COOKIE` to seed an existing account). It signs in test users, solves real Sudoku and Nonogram levels, and posts completions with varied posting dates through the test-only `seedRecordedAt` field. The signed-in leaderboard smoke covers the player summary, the top-ten board, the tied-rank rail, quick-board seed and Play, admin filters, and the labelled removal notice.
Mobile checks cover 390×844, 360×800, 320×568 and 844×390 landscape, plus 200% text: no horizontal overflow, 44px targets, sticky hub/board navigation, the two-up player summary and Quick Play grid, the collapsed board row, the twenty-at-a-time admin table, and long removal reasons that scroll inside the dialog.
The leaderboard browser checks also cover the raw **All records** view and the pack aggregate card/detail; verify the account menu opens below the upper-right profile and the bottom navigation fits at 393px with an editor account.

Check layered Back behavior in a browser and on a phone: from a pack game, Back should go to the pack roadmap, then the game menu, then the library; Quick Play should skip the selector and return to the game menu. Opening a game from Continue, History, or a deep link should still land on the level selector rather than the library. In Studio, Back should move from test play to the pack editor, then to **My packs**, then to Studio (or the game menu it was opened from), and reloading a pack editor should restore it.

Before a household deployment, verify the real flow against the existing Pocket ID provider. Try sign-in and sign-out and confirm Player, Creator, and Admin permissions. Independently confirm that two accounts see the same level and grade after publishing. Install and play offline on iOS, Android, and the target BOOX device. Restore a backup into a temporary database and check the relevant published level, player save, and completion. Browser storage is device-dependent, so test download, airplane mode, and reopen on the actual devices.

Run `npm run test:oidc` with `AVIARIUM_OIDC_TEST_DATABASE_URL` pointing at a disposable PostgreSQL database. This test uses Chromium and a local HTTPS OIDC fixture to check PKCE sign-in, switching between two identities, account isolation, and sign-out.

Run `npm run test:localization` after building, with
`AVIARIUM_I18N_TEST_DATABASE_URL` pointing at a disposable PostgreSQL database.
The test starts a local app with a simulated translation provider and checks
admin review, bilingual publication, shared likes, and resuming a saved Sudoku
puzzle after an offline language change. Set `AVIARIUM_CHROMIUM` to use a system Chromium.


To run the browser suites together, build the app and point the runner at a disposable PostgreSQL server with a user who can create databases:

```sh
AVIARIUM_BROWSER_TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/postgres npm run test:browser
```

The runner creates and removes separate databases for the OIDC, localization, and signed-in smoke tests. The signed-in run also executes `tests/leaderboards-smoke.mjs` with a second player fixture and the disposable database URL; it covers Sudoku and Nonograms boards, the per-exact-puzzle cooldown, tie ranks, admin removal, the once-only notice, and playing a result's exact grid. The **Verify** workflow runs the same suite on pull requests and pushes to `main`. **Publish container** calls it again when you start a manual release.

The browser suite also upgrades a database containing legacy Sudoku publications, checks ordered pack expansion with ten completed stops, and covers offline Studio autosave and level rule overrides.
