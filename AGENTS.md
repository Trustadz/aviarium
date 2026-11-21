# Aviarium repository instructions

These instructions apply to Aviarium. Follow the user's current request when
it specifies a narrower scope or a different workflow.

## Branch, test, and review

- Use a dedicated branch under `codex/` for each distinct change. Keep
  unrelated work on its own branch or in its own checkout. Preserve existing
  working files and stage only the intended paths.
- For changes the user wants to test, run a local preview from the feature
  branch with a dedicated database and localhost-only test mode where needed.
  Give the user the preview URL. A local preview does not put code on GitHub.
- Before opening a draft PR, run `npm run typecheck`, `npm test`, and
  `npm run build`. Run `npm run test:browser` against disposable PostgreSQL
  for changes that affect the application, migrations, or release workflow.
  Report which checks ran and any remaining manual verification.
- Open a draft PR against `main` for user testing and review after the local
  checks pass. Include the preview and checks that correspond to the PR.
  Update that PR as feedback comes in. GitHub checks run for both draft and
  ready PRs.
- Let the user test and approve before merging. A request to review or test
  does not authorize merging or publishing. A request to publish the change
  authorizes merging its passing PR and running the release workflow.

## Release

- Keep version bumps with the changes intended to ship or in a release PR.
  Create a News announcement only when the user explicitly requests one.
- Merging runs checks. Shipping is a separate, manual **Publish container**
  workflow on `main`. Trigger it only when the user authorizes publication.
  The owner can trigger it directly in GitHub Actions.
- After publishing, verify that the version and `latest` image tags match.
  See [release instructions](README.md#publish-a-release).
