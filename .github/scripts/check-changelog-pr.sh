#!/usr/bin/env bash
# Enforce the pull-request changelog rules for the Changelog workflow.
# Required environment: BASE_SHA, HEAD_SHA, PR_LABELS (JSON array).
set -euo pipefail

PR_LABELS=${PR_LABELS:-[]}

if jq -e 'index("changelog-not-required")' <<<"$PR_LABELS" >/dev/null; then
  echo "Changelog fragment not required (label: changelog-not-required)."
  exit 0
fi

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"

changed=$(git diff --name-status "$BASE_SHA...$HEAD_SHA")

if grep -qE '(^|[[:space:]])CHANGELOG\.md([[:space:]]|$)' <<<"$changed"; then
  echo "::error::Do not edit CHANGELOG.md in a pull request. Add a fragment under changelog.d/ instead."
  exit 1
fi

if ! grep -qE '^A[[:space:]]+changelog\.d/[^/]+\.(added|changed|fixed|improved|security|upgrade)\.md$' <<<"$changed"; then
  echo "::error::Add a changelog fragment under changelog.d/ (or apply the changelog-not-required label)."
  exit 1
fi

echo "Changelog fragment added."
