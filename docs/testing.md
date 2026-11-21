# Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Core tests cover the solver outcomes, difficulty, generated puzzle reproducibility, move rules, and backup settings.

For a local Compose smoke test, install Chromium or run `npx playwright install chromium`. Set `AVIARIUM_CHROMIUM` if using a system Chromium executable. Set `AVIARIUM_TEST_URL` to the local running app. The script defaults to `http://localhost:4183`. Point it at a disposable deployment. It creates draft, job, save, and publication records when administrator and player fixtures are supplied.

`npm run test:smoke` tests the signed-out gate, touch and keyboard controls, undo/redo, pause, e-reader, and offline reload. Set `AVIARIUM_TEST_PLAYER` or `AVIARIUM_TEST_ADMIN` to a raw session cookie for a test account. Supply both for server permissions and privileged-browser coverage. Set `AVIARIUM_TEST_BACKUPS=1` to also exercise Run now and rolling retention in a smoke subfolder. `AVIARIUM_SCREENSHOTS` can name an existing directory for browser screenshots.

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

The runner creates and removes separate databases for the OIDC, localization, and signed-in smoke tests. GitHub runs the same suite on pull requests, pushes to `main`, and manual releases.
