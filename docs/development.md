# Aviarium development workflow

This workflow assumes a local checkout, Git, and permission to push a feature
branch and open a draft pull request on GitHub. Node 24 and npm run the project.
The full browser suite also needs Chromium and disposable PostgreSQL 15.
Docker is one way to supply PostgreSQL. A local test session needs no Pocket
ID account or translation provider credentials.

## Pick up a change

1. Read [AGENTS.md](../AGENTS.md), the request, and the relevant parts of the
   [architecture](architecture.md) and [verification guide](testing.md). If
   the task names an issue or PR, read its description and discussion with
   `gh issue view NUMBER --comments` or `gh pr view NUMBER --comments`.
2. Inspect `git status --short --branch`, `git worktree list`, and the open
   PRs with `gh pr list --state open`. Compare likely changes to shared routes,
   contracts, migrations, and browser fixtures. Coordinate the order in the
   affected PRs when changes depend on each other. Use a single contributor
   per branch at a time and verify overlapping work against the resulting
   `main` when the dependency lands.
3. For a new change, start a dedicated `codex/` branch from the current
   `origin/main`. A linked worktree keeps existing work and local files in
   place. Pick a unique branch and directory and run from the new worktree.
   For a continuation, use the existing PR branch after checking that its
   checkout is available and identifying any work already in progress.

   ```sh
   git fetch origin main
   git worktree add -b codex/short-description ../aviarium-short-description origin/main
   cd ../aviarium-short-description
   npm ci
   ```

4. Trace the change through its normal entry points. Preserve existing
   behavior outside the requested scope. Include any affected user-visible
   strings in both locale catalogs and check existing data when changing
   saved state or published content. Document durable decisions with their
   rationale and compatibility implications in the nearest relevant doc.

Check `git log -- <path>` for the history behind a choice. Capture any necessary
product clarification in the task or PR so it travels with the work. Compare
`git diff origin/main...HEAD` and the PR discussion before taking over a branch.

## Run an isolated preview

Start with a database dedicated to this change. For example, the following
starts PostgreSQL in a disposable container with a Docker-assigned loopback
port. Choose a unique container name, and wait until the readiness command
reports that it is accepting connections.

```sh
export AVIARIUM_DEV_DB=aviarium-db-short-description
docker run --rm -d --name "$AVIARIUM_DEV_DB" \
  -e POSTGRES_PASSWORD=aviarium-local-test \
  -p 127.0.0.1::5432 postgres:15-bookworm
docker exec "$AVIARIUM_DEV_DB" pg_isready -h 127.0.0.1 -U postgres
export AVIARIUM_DEV_DB_URL="postgresql://postgres:aviarium-local-test@$(docker port "$AVIARIUM_DEV_DB" 5432/tcp)/postgres"
```

Build and run the same Fastify entry point used by the app container. Choose a
free loopback port for the preview and keep `PORT` and `PUBLIC_ORIGIN` aligned.
Port 4183 is reserved by the combined browser suite while it runs.

```sh
npm run build
export AVIARIUM_DEV_BACKUP_DIR="$(mktemp -d)"
DATABASE_URL="$AVIARIUM_DEV_DB_URL" HOST=127.0.0.1 APP_BIND=127.0.0.1 \
  PORT=4175 PUBLIC_ORIGIN=http://127.0.0.1:4175 BACKUP_ROOT="$AVIARIUM_DEV_BACKUP_DIR" \
  TEST_ENVIRONMENT=true npm start
```

Use `http://127.0.0.1:4175/health/ready` to verify startup. Open
`http://127.0.0.1:4175` and use **Account menu → Device settings → Test user
role** for User, Editor, and Admin flows. Use the built app to test
service worker installation, upgrades, and offline play. Each browser origin
has its own cookies, IndexedDB, and service worker, so give parallel previews
different ports. For backup changes, install the PostgreSQL client tools and
keep the backup directory outside the staged diff.

The root Compose files are the deployment and source-build defaults. They
use fixed container names, so a distinct Compose project name alone cannot
isolate concurrent previews. The host-side commands above avoid those
collisions. See [deployment](deployment.md#test-without-pocket-id) for the
equivalent application modes. Keep a requested preview running for handoff.
When done with this disposable environment, stop its app process and run
`docker stop "$AVIARIUM_DEV_DB"`.

## Verify and request local approval

Run `npm run typecheck`, `npm test`, and `npm run build` before requesting
local approval. For application, migration, or release workflow changes,
also run the combined browser suite. Install Chromium with `npx playwright install chromium`
or set `AVIARIUM_CHROMIUM` to a compatible installed executable. See
[verification](testing.md) for narrower runs and manual device checks.

```sh
AVIARIUM_BROWSER_TEST_DATABASE_URL="$AVIARIUM_DEV_DB_URL" npm run test:browser
```

The combined runner creates and drops its own databases on that PostgreSQL
server. Its smoke app uses fixed port 4183, so run one combined suite at a time
per host and leave that port free. The OIDC and localization apps default to
4192 and 4194. Set `AVIARIUM_OIDC_TEST_PORT` and
`AVIARIUM_I18N_TEST_PORT` to free ports if those defaults are occupied. For
documentation-only work, also check changed internal links and examples
against the checkout.

Inspect `git status` and the full local diff. Give the user the preview URL
for application changes or point to the local diff for documentation changes.
Share the check results and the manual scenarios the user can review.

Ask the user to approve the local changes for GitHub. Wait for an explicit
approval before pushing or opening or updating a PR. If the user asks for
changes, verify the revised version and request approval again.

## Publish an approved draft

After approval, stage explicit paths, commit the reviewed change, and push the
named feature branch. Create a draft PR against `main` or update the existing
draft. For example, after confirming GitHub CLI authentication:

```sh
git push -u origin codex/short-description
gh pr create --draft --base main --head codex/short-description \
  --title "Describe the change" --body-file /tmp/aviarium-pr-body.md
```

Record the approved local handoff in the draft PR. Include the requested
behavior and why it changed, relevant design choices, the current commit, check
commands and outcomes, and remaining manual scenarios with expected results. If a preview is running,
give its URL, branch or commit, and setup steps. A loopback URL is usable only
on its host, so include reproduction steps for a reviewer with a different
checkout. Link the issue if there is one. Use `enhancement` or `feature` for
features and `bug` or `fix` for fixes.

Read the PR thread and check results with `gh pr view NUMBER --comments` and
`gh pr checks NUMBER`. GitHub runs **Verify** on drafts and ready PRs. Address
feedback on the same branch, rerun affected checks, and obtain local approval
before pushing the revised commit and updating the PR. Report environment or
authentication blockers with what was verified locally. Merge and production publishing require owner authorization.
For an authorized release, use the [release workflow](../README.md#publish-a-release).
