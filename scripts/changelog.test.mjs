import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  CATEGORIES,
  buildReleaseChangelog,
  parseFragmentFilename,
  readFragments,
  releaseChangelog,
  renderFragments,
  renderPendingRelease,
  validateFragments,
} from './changelog.mjs'

const temporaryDirectories = []

function temporaryDirectory() {
  const dir = mkdtempSync(join(tmpdir(), 'aviarium-changelog-'))
  temporaryDirectories.push(dir)
  return dir
}

function fragmentDirectory(files) {
  const dir = join(temporaryDirectory(), 'changelog.d')
  mkdirSync(dir)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

function changelogPath(source) {
  const path = join(temporaryDirectory(), 'CHANGELOG.md')
  writeFileSync(path, source)
  return path
}

after(() => {
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true })
})

test('parseFragmentFilename accepts numbered and +slug names', () => {
  assert.deepEqual(parseFragmentFilename('123.added.md'), {
    slug: '123',
    category: 'added',
  })
  assert.deepEqual(parseFragmentFilename('+dark-mode.added.md'), {
    slug: 'dark-mode',
    category: 'added',
  })
  assert.deepEqual(parseFragmentFilename('fix_login.fixed.md'), {
    slug: 'fix_login',
    category: 'fixed',
  })
  assert.deepEqual(parseFragmentFilename('1.2.3.upgrade.md'), {
    slug: '1.2.3',
    category: 'upgrade',
  })
})

test('parseFragmentFilename rejects malformed names and unknown categories', () => {
  const invalid = [
    'README.md',
    '123.md',
    '123.ADDED.md',
    '123.unknown.md',
    '123.added.markdown',
    '123.added.md.bak',
    'Bad Name.added.md',
    '+.added.md',
    '.hidden.added.md',
    '.added.md',
  ]
  for (const name of invalid) assert.equal(parseFragmentFilename(name), null, name)
})

test('readFragments sorts filenames and ignores README, hidden files, and directories', () => {
  const dir = fragmentDirectory({
    '20.fixed.md': 'Fix twenty.\n',
    '10.added.md': 'Add ten.\n',
    '.hidden.added.md': 'Ignore me.\n',
    'README.md': '# Documentation\n',
    'not-a-fragment.md': 'Still readable so validation can report it.\n',
  })
  mkdirSync(join(dir, 'nested.added.md'))

  const fragments = readFragments(dir)
  assert.deepEqual(
    fragments.map(fragment => fragment.file),
    ['10.added.md', '20.fixed.md', 'not-a-fragment.md'],
  )
  assert.deepEqual(fragments[0], {
    file: '10.added.md',
    slug: '10',
    category: 'added',
    body: 'Add ten.\n',
  })
  assert.equal(fragments[1].category, 'fixed')
  assert.equal(fragments[2].slug, null)
  assert.equal(fragments[2].category, null)
})

test('validateFragments reports every error and ignores documentation', () => {
  const dir = fragmentDirectory({
    'README.md': '## This heading is allowed in documentation.\n',
    '.ignored.added.md': '',
    '12.added.md': '   \n\n',
    '13.fixed.md': '## A heading\nA body.\n',
    '14.unknown.md': 'Unknown category.\n',
    'Bad Name.added.md': 'Malformed name.\n',
    '15.changed.md': 'A valid change.\n',
    '16.improved.md': '- A valid bullet-prefixed improvement.\n',
  })

  const errors = validateFragments(dir)
  assert.equal(errors.length, 4)
  const report = errors.join('\n')
  assert.match(report, /12\.added\.md: body is empty/)
  assert.match(report, /13\.fixed\.md: body contains a Markdown heading/)
  assert.match(report, /14\.unknown\.md: unknown category "unknown"/)
  assert.match(report, /Bad Name\.added\.md: invalid fragment filename/)
  assert.doesNotMatch(report, /README\.md/)
  assert.doesNotMatch(report, /ignored/)
})

test('validateFragments reports a missing directory', () => {
  const errors = validateFragments(join(temporaryDirectory(), 'missing'))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fragment directory does not exist/)
})

test('renderFragments renders sections in release order and omits empty ones', () => {
  const fragments = CATEGORIES.map((category, index) => ({
    file: `${index}.${category}.md`,
    category,
    body: `${category} entry`,
  }))
  const markdown = renderFragments(fragments)
  const headings = markdown.split('\n').filter(line => line.startsWith('### '))
  assert.deepEqual(headings, [
    '### Added',
    '### Changed',
    '### Fixed',
    '### Improved',
    '### Security notes',
    '### Upgrade notes',
  ])

  const onlyAdded = renderFragments([{ category: 'added', body: 'One.' }])
  assert.equal(onlyAdded, '### Added\n- One.')
})

test('renderFragments strips one bullet and indents continuation lines', () => {
  const markdown = renderFragments([
    {
      file: '1.added.md',
      category: 'added',
      body: '- **First.** Line one\r\nflush continuation\r\n\r\nlast paragraph\r\n',
    },
    {
      file: '2.changed.md',
      category: 'changed',
      body: '* **Second.** Bullet stripped.\ncontinued\n',
    },
  ])

  assert.equal(
    markdown,
    [
      '### Added',
      '- **First.** Line one',
      '  flush continuation',
      '',
      '  last paragraph',
      '',
      '### Changed',
      '- **Second.** Bullet stripped.',
      '  continued',
    ].join('\n'),
  )
})

test('renderFragments rejects invalid entries instead of skipping them', () => {
  assert.throws(
    () => renderFragments([{ file: '1.added.md', category: 'added', body: '  ' }]),
    /body is empty/,
  )
  assert.throws(
    () =>
      renderFragments([
        { file: '1.added.md', category: 'added', body: '## Heading\nText' },
      ]),
    /Markdown heading/,
  )
  assert.throws(
    () => renderFragments([{ file: '1.added.md', category: 'other', body: 'Text' }]),
    /unknown category/,
  )
})

test('buildReleaseChangelog folds curated Unreleased content and fragments', () => {
  const source = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    'Legacy curated note.',
    '',
    '## 0.1.0 — 2025-01-01',
    '',
    '- Old release.',
    '',
  ].join('\n')

  const output = buildReleaseChangelog(source, 'v1.2.3', '2025-11-24', [
    { file: '9.added.md', category: 'added', body: 'New feature.' },
    { file: '8.fixed.md', category: 'fixed', body: 'Bug fix.' },
  ])

  assert.equal(
    output,
    [
      '# Changelog',
      '',
      '## Unreleased',
      '',
      '## 1.2.3 — 2025-11-24',
      '',
      'Legacy curated note.',
      '',
      '### Added',
      '- New feature.',
      '',
      '### Fixed',
      '- Bug fix.',
      '',
      '## 0.1.0 — 2025-01-01',
      '',
      '- Old release.',
      '',
    ].join('\n'),
  )
  assert.match(output, /## Unreleased\n\n## 1\.2\.3 — 2025-11-24/)
  assert.ok(
    output.indexOf('Legacy curated note.') < output.indexOf('### Added'),
    'curated content comes before fragments',
  )
  assert.ok(output.endsWith('## 0.1.0 — 2025-01-01\n\n- Old release.\n'))
})

test('buildReleaseChangelog supports fragments with an empty Unreleased section', () => {
  const output = buildReleaseChangelog(
    '# Changelog\n\n## Unreleased\n',
    '1.0.0',
    '2025-01-01',
    [{ file: '1.added.md', category: 'added', body: 'First release.' }],
  )
  assert.equal(
    output,
    '# Changelog\n\n## Unreleased\n\n## 1.0.0 — 2025-01-01\n\n### Added\n- First release.\n',
  )
})

test('buildReleaseChangelog folds legacy content when there are no fragments', () => {
  const source = '# Changelog\n\n## Unreleased\n\nLegacy note.\n'
  const output = buildReleaseChangelog(source, '0.2.0', '2025-11-24', [])
  assert.equal(
    output,
    '# Changelog\n\n## Unreleased\n\n## 0.2.0 — 2025-11-24\n\nLegacy note.\n',
  )
})

test('buildReleaseChangelog refuses to create an empty release', () => {
  assert.throws(
    () =>
      buildReleaseChangelog(
        '# Changelog\n\n## Unreleased\n',
        '1.0.0',
        '2025-01-01',
        [],
      ),
    /Nothing to release/,
  )
})

test('buildReleaseChangelog requires an Unreleased heading', () => {
  assert.throws(
    () =>
      buildReleaseChangelog(
        '# Changelog\n\n## 0.1.0 — 2025-01-01\n',
        '1.0.0',
        '2025-01-01',
        [],
      ),
    /must contain a "## Unreleased" heading/,
  )
})

test('buildReleaseChangelog rejects invalid versions and dates', () => {
  const source = '# Changelog\n\n## Unreleased\n\nNote.\n'
  for (const version of ['1.2', 'v1.2.3.4', '01.2.3', 'release-1.2.3', ''])
    assert.throws(
      () => buildReleaseChangelog(source, version, '2025-01-01', []),
      /invalid version|version must be/,
      version,
    )
  for (const date of ['2025-1-1', '24-01-01', '2025-02-30', '2025-13-01', 'today'])
    assert.throws(
      () => buildReleaseChangelog(source, '1.2.3', date, []),
      /invalid date|date must be/,
      date,
    )

  assert.doesNotThrow(() =>
    buildReleaseChangelog(source, '1.2.3', '2024-02-29', []),
  )
})

test('buildReleaseChangelog fails closed on malformed fragments', () => {
  const source = '# Changelog\n\n## Unreleased\n\nNote.\n'
  assert.throws(
    () =>
      buildReleaseChangelog(source, '1.0.0', '2025-01-01', [
        { file: '1.added.md', category: 'added', body: '## Heading' },
      ]),
    /Markdown heading/,
  )
  assert.throws(
    () =>
      buildReleaseChangelog(source, '1.0.0', '2025-01-01', [
        { file: '1.added.md', category: 'added', body: '' },
      ]),
    /body is empty/,
  )
  assert.throws(
    () =>
      buildReleaseChangelog(source, '1.0.0', '2025-01-01', [
        { file: '1.added.md', category: 'nope', body: 'Text' },
      ]),
    /unknown category/,
  )
})

test('renderPendingRelease combines curated content and fragments in order', () => {
  const source = '# Changelog\n\n## Unreleased\n\nCurated.\n\n## 0.1.0 — 2025-01-01\n'
  const pending = renderPendingRelease(source, [
    { file: '1.fixed.md', category: 'fixed', body: 'Fixed.' },
  ])
  assert.equal(pending, 'Curated.\n\n### Fixed\n- Fixed.')
})

test('releaseChangelog writes the changelog, deletes only fragments, and keeps README', () => {
  const root = temporaryDirectory()
  const dir = join(root, 'changelog.d')
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.md'), '# Documentation\n')
  writeFileSync(join(dir, '.hidden.added.md'), 'Not a fragment.\n')
  writeFileSync(join(dir, '101.added.md'), '**New.** Added.\n')
  writeFileSync(join(dir, '102.fixed.md'), 'Fixed a bug.\n')
  const changelog = join(root, 'CHANGELOG.md')
  writeFileSync(changelog, '# Changelog\n\n## Unreleased\n\nLegacy.\n')

  const count = releaseChangelog({
    version: '0.2.0',
    date: '2025-11-24',
    dir,
    changelogPath: changelog,
  })

  assert.equal(count, 2)
  const output = readFileSync(changelog, 'utf8')
  assert.match(output, /## 0\.2\.0 — 2025-11-24/)
  assert.match(output, /Legacy\./)
  assert.match(output, /### Added\n- \*\*New\.\*\* Added\./)
  assert.match(output, /### Fixed\n- Fixed a bug\./)
  assert.deepEqual(readdirSync(dir).sort(), ['.hidden.added.md', 'README.md'])
})

test('releaseChangelog deletes nothing when a fragment is malformed', () => {
  const root = temporaryDirectory()
  const dir = join(root, 'changelog.d')
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.md'), '# Documentation\n')
  writeFileSync(join(dir, '1.added.md'), 'Valid.\n')
  writeFileSync(join(dir, '2.fixed.md'), '## Invalid heading\n')
  const changelog = join(root, 'CHANGELOG.md')
  const original = '# Changelog\n\n## Unreleased\n\nLegacy.\n'
  writeFileSync(changelog, original)

  assert.throws(
    () =>
      releaseChangelog({
        version: '0.2.0',
        date: '2025-11-24',
        dir,
        changelogPath: changelog,
      }),
    /Cannot release with invalid fragments/,
  )
  assert.equal(readFileSync(changelog, 'utf8'), original)
  assert.deepEqual(readdirSync(dir).sort(), ['1.added.md', '2.fixed.md', 'README.md'])
})

test('releaseChangelog deletes nothing when the changelog cannot be folded', () => {
  const root = temporaryDirectory()
  const dir = join(root, 'changelog.d')
  mkdirSync(dir)
  writeFileSync(join(dir, '1.added.md'), 'Valid.\n')
  const changelog = join(root, 'CHANGELOG.md')
  const original = '# Changelog\n\n## 0.1.0 — 2025-01-01\n\nOld.\n'
  writeFileSync(changelog, original)

  assert.throws(
    () =>
      releaseChangelog({
        version: '0.2.0',
        date: '2025-11-24',
        dir,
        changelogPath: changelog,
      }),
    /## Unreleased/,
  )
  assert.equal(readFileSync(changelog, 'utf8'), original)
  assert.equal(existsSync(join(dir, '1.added.md')), true)
})

test('releaseChangelog folds legacy content when no fragments remain', () => {
  const root = temporaryDirectory()
  const dir = join(root, 'changelog.d')
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.md'), '# Documentation\n')
  const changelog = join(root, 'CHANGELOG.md')
  writeFileSync(changelog, '# Changelog\n\n## Unreleased\n\nLegacy only.\n')

  const count = releaseChangelog({
    version: '0.3.0',
    date: '2025-12-01',
    dir,
    changelogPath: changelog,
  })

  assert.equal(count, 0)
  assert.match(readFileSync(changelog, 'utf8'), /## 0\.3\.0 — 2025-12-01\n\nLegacy only\./)
  assert.deepEqual(readdirSync(dir), ['README.md'])
})
