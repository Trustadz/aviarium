import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

const scriptPath = fileURLToPath(
  new URL('../.github/scripts/check-changelog-pr.sh', import.meta.url),
)
const temporaryDirectories = []

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(root, path, contents) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
}

function createRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'aviarium-ci-rules-'))
  temporaryDirectories.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Changelog test')
  git(dir, 'config', 'user.email', 'changelog@example.com')
  git(dir, 'config', 'commit.gpgsign', 'false')
  write(dir, 'README.md', '# Fixture\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'initial')
  return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}

function commitFeature(repository, files) {
  const { dir } = repository
  git(dir, 'checkout', '-q', '-b', 'feature')
  for (const [path, contents] of Object.entries(files)) write(dir, path, contents)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feature change')
  return git(dir, 'rev-parse', 'HEAD')
}

function runCheck(dir, base, head, labels = []) {
  return spawnSync('bash', [scriptPath], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      BASE_SHA: base,
      HEAD_SHA: head,
      PR_LABELS: JSON.stringify(labels),
    },
  })
}

after(() => {
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true })
})

test('accepts a pull request that adds one fragment', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'changelog.d/123.added.md': '**New.** A feature.\n',
  })
  const result = runCheck(repository.dir, repository.base, head)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Changelog fragment added/)
})

test('rejects a pull request that edits CHANGELOG.md', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- Manual entry.\n',
    'changelog.d/123.added.md': 'A feature.\n',
  })
  const result = runCheck(repository.dir, repository.base, head)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Do not edit CHANGELOG\.md/)
})

test('requires an added fragment when the pull request is not labeled', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'README.md': '# Fixture\n\nUnrelated documentation change.\n',
  })
  const result = runCheck(repository.dir, repository.base, head)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Add a changelog fragment/)
})

test('exempts a labeled pull request without a fragment', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'README.md': '# Fixture\n\nChore only.\n',
  })
  const result = runCheck(repository.dir, repository.base, head, [
    'changelog-not-required',
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /not required/)
})

test('the exemption label also permits the post-release CHANGELOG edit', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## 0.2.0 — 2025-11-24\n',
    'changelog.d/README.md': '# Documentation\n',
  })
  const result = runCheck(repository.dir, repository.base, head, [
    'changelog-not-required',
  ])
  assert.equal(result.status, 0, result.stderr)
})

test('other labels do not exempt a pull request', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'README.md': '# Fixture\n\nFeature documentation.\n',
  })
  const result = runCheck(repository.dir, repository.base, head, ['enhancement'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Add a changelog fragment/)
})

test('rejects an added changelog.d file with an invalid name', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'changelog.d/123.md': 'A feature.\n',
  })
  const result = runCheck(repository.dir, repository.base, head)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Add a changelog fragment/)
})

test('requires an added fragment, not an edit to an existing one', () => {
  const repository = createRepository()
  write(repository.dir, 'changelog.d/old.added.md', 'Existing.\n')
  git(repository.dir, 'add', '-A')
  git(repository.dir, 'commit', '-q', '-m', 'add existing fragment')
  const base = git(repository.dir, 'rev-parse', 'HEAD')

  const head = commitFeature(repository, {
    'changelog.d/old.added.md': 'Existing but edited.\n',
  })
  const result = runCheck(repository.dir, base, head)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Add a changelog fragment/)
})

test('the three-dot diff ignores changes that landed on main after the branch point', () => {
  const repository = createRepository()
  const head = commitFeature(repository, {
    'changelog.d/456.fixed.md': 'A fix.\n',
  })

  git(repository.dir, 'checkout', '-q', 'main')
  write(repository.dir, 'README.md', '# Fixture\n\nMain-only change.\n')
  git(repository.dir, 'add', '-A')
  git(repository.dir, 'commit', '-q', '-m', 'main change')
  const mainTip = git(repository.dir, 'rev-parse', 'HEAD')

  const result = runCheck(repository.dir, mainTip, head)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Changelog fragment added/)
})
