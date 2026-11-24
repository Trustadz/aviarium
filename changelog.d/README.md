# Changelog fragments

Every pull request that changes user-visible behavior adds **one new file** to
this directory. Pull requests do not edit `CHANGELOG.md`; the release tooling
renders fragments into the release notes and later folds them into a dated
section. Because each pull request owns a new filename, parallel pull requests
never edit the same changelog file and changelog merge conflicts cannot occur.

This `README.md` is documentation. It is never treated as a fragment.

## Name the file

Filenames use `<slug>.<category>.md`:

```
^\+?([a-z0-9][a-z0-9._-]*)\.(added|changed|fixed|improved|security|upgrade)\.md$
```

- `<slug>` uses lowercase letters, digits, `.`, `_`, and `-`.
- Prefer the pull-request or issue number when it is known:
  `142.added.md`.
- Without a number, use a descriptive branch slug: `+dark-mode.added.md`.
  A leading `+` is allowed only when no number is available.
- `<category>` is one of `added`, `changed`, `fixed`, `improved`, `security`,
  or `upgrade`.
- Pick a filename that is unique across branches. Do not rename a fragment
  that another pull request already uses.

## Write the entry

Write the body exactly as it should appear in the release notes.

- One entry per file.
- Do not start the first line with a bullet. The compiler adds `- `.
  A single leading `- ` or `* ` is stripped if present.
- Do not add Markdown headings (`#` through `######`). The compiler owns the
  section structure.
- Multi-line entries are allowed. Continuation lines are indented by two
  spaces, so they may be flush left in the file. A blank line starts a new
  paragraph within the same entry.
- A `*.upgrade.md` entry must state the migration or operator action.

Example, `142.added.md`:

```markdown
**Faster exports.** CSV exports now stream in the background, so large
exports no longer block the page.
```

The compiler renders categories in this order and omits empty sections:
Added, Changed, Fixed, Improved, Security notes, Upgrade notes.

## Commands

Run these from the repository root with Node 24:

```sh
npm run changelog:check                 # validate every fragment, report all errors
npm run changelog:render                # print the pending release sections
npm run changelog:pending               # print curated Unreleased content + fragments
npm run changelog:release -- X.Y.Z      # fold into CHANGELOG.md and delete fragments
```

`changelog:release` also accepts `vX.Y.Z` and an optional `--date YYYY-MM-DD`
(useful for backfilling). It refuses to run when a fragment is malformed or
when there is nothing to release, so a failed run never deletes fragments.
Only the consumed fragment files are removed; this `README.md` remains.

## Pull-request check

The separate **Changelog** workflow runs on every pull request and on pushes
to `main`. It validates all fragments with `npm run changelog:check`. On pull
requests it also checks the diff from the merge base:

1. `CHANGELOG.md` must not be edited in the pull request.
2. At least one new `changelog.d/<slug>.<category>.md` file must be added.

Pull requests with no user-visible change are exempt. Apply the
`changelog-not-required` label for chores, tests, refactors, and the
post-release fold pull request. The label check runs before the diff rules, so
a labeled pull request may omit a fragment and may edit `CHANGELOG.md`.

The workflow is intentionally separate from **Verify**: adding or removing the
label reruns only this cheap check instead of the full browser suite.

## Release flow

1. Pull requests add fragments. They do not edit `CHANGELOG.md`.
2. **Publish container** combines, in order, any curated `## Unreleased`
   content, the rendered fragments (`npm run changelog:pending`), and GitHub's
   generated pull-request notes.
3. After publishing, open a small post-release pull request and run
   `npm run changelog:release -- X.Y.Z`. That folds the remaining curated
   content and fragments into `## X.Y.Z — YYYY-MM-DD`, leaves `## Unreleased`
   empty, preserves earlier releases, and deletes the consumed fragments.
4. Apply `changelog-not-required` to that post-release pull request because it
   intentionally edits `CHANGELOG.md` and deletes fragments.

## Repository setup

The exemption label and required status check are repository settings, not
files in this directory. A repository administrator must:

- create the `changelog-not-required` label; and
- add the **Changelog check** status check to the `main` branch protection
  required checks (the job comes from the **Changelog** workflow).

If the label is missing, contributors cannot use the exemption. If the status
check is not required, a failing Changelog check does not block merging.
