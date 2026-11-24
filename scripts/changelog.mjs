#!/usr/bin/env node
/**
 * Changelog fragment compiler for Aviarium.
 *
 * This module has no runtime dependencies. It is both the library used by the
 * tests and the CLI exposed through `npm run changelog:*` in package.json.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CATEGORIES = [
  'added',
  'changed',
  'fixed',
  'improved',
  'security',
  'upgrade',
]

export const SECTION_TITLES = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  improved: 'Improved',
  security: 'Security notes',
  upgrade: 'Upgrade notes',
}

const FILENAME_PATTERN =
  /^\+?([a-z0-9][a-z0-9._-]*)\.(added|changed|fixed|improved|security|upgrade)\.md$/
const LOOSE_FILENAME_PATTERN = /^\+?([a-z0-9][a-z0-9._-]*)\.([a-z]+)\.md$/
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const HEADING_PATTERN = /^[ \t]{0,3}#{1,6}[ \t]/m
const UNRELEASED_PATTERN = /^##[ \t]+Unreleased[ \t]*$/
const RELEASE_HEADING_PATTERN = /^##[ \t]+\S/

/**
 * Parse a fragment filename. Returns null for anything outside the contract.
 *
 * @param {string} name
 * @returns {{ slug: string, category: string } | null}
 */
export function parseFragmentFilename(name) {
  if (typeof name !== 'string') return null
  const match = FILENAME_PATTERN.exec(name)
  if (!match) return null
  return { slug: match[1], category: match[2] }
}

/**
 * Read every candidate fragment file in a directory, sorted by filename.
 * README.md, hidden files, and subdirectories are ignored. Files with invalid
 * names are returned with null slug/category so validation can report them.
 *
 * @param {string} dir
 * @returns {Array<{ file: string, slug: string | null, category: string | null, body: string }>}
 */
export function readFragments(dir) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name !== 'README.md' && !name.startsWith('.'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

  return names.map(file => {
    const parsed = parseFragmentFilename(file)
    return {
      file,
      slug: parsed?.slug ?? null,
      category: parsed?.category ?? null,
      body: readFileSync(join(dir, file), 'utf8'),
    }
  })
}

function normalizeBody(body) {
  return String(body ?? '').replace(/\r\n?/g, '\n')
}

function bodyErrors(file, body) {
  if (typeof body !== 'string') return [`${file}: body is missing`]
  const normalized = normalizeBody(body)
  const errors = []
  if (normalized.trim() === '')
    errors.push(`${file}: body is empty`)
  if (HEADING_PATTERN.test(normalized))
    errors.push(
      `${file}: body contains a Markdown heading; the compiler owns section structure`,
    )
  return errors
}

function filenameError(name) {
  const loose = LOOSE_FILENAME_PATTERN.exec(name)
  if (loose && !CATEGORIES.includes(loose[2]))
    return `${name}: unknown category "${loose[2]}"; expected one of ${CATEGORIES.join(', ')}`
  return `${name}: invalid fragment filename; expected <slug>.<category>.md`
}

function fragmentListErrors(fragments) {
  if (!Array.isArray(fragments)) return ['fragments must be an array']
  const errors = []
  for (const fragment of fragments) {
    const file = fragment?.file ?? 'fragment'
    if (!fragment || typeof fragment !== 'object') {
      errors.push(`${file}: fragment must be an object`)
      continue
    }
    if (!CATEGORIES.includes(fragment.category))
      errors.push(
        `${file}: unknown category "${fragment.category}"; expected one of ${CATEGORIES.join(', ')}`,
      )
    if (typeof fragment.body !== 'string') errors.push(`${file}: body is missing`)
    else errors.push(...bodyErrors(file, fragment.body))
  }
  return errors
}

/**
 * Validate every fragment in a directory. All errors are returned in one pass;
 * the function never stops after the first problem.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function validateFragments(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    return [`${dir}: fragment directory does not exist`]

  const errors = []
  for (const fragment of readFragments(dir)) {
    if (!parseFragmentFilename(fragment.file))
      errors.push(filenameError(fragment.file))
    errors.push(...bodyErrors(fragment.file, fragment.body))
  }
  return errors
}

function renderEntry(body) {
  const normalized = normalizeBody(body).trim()
  if (normalized === '') throw new Error('cannot render an empty fragment body')

  const lines = normalized.split('\n').map(line => line.replace(/[ \t]+$/, ''))
  const firstLine = lines[0].replace(/^[-*][ \t]+/, '')
  const rendered = [`- ${firstLine}`]
  for (const line of lines.slice(1))
    rendered.push(line.trim() === '' ? '' : `  ${line}`)
  return rendered.join('\n')
}

/**
 * Render fragments into category sections in the fixed release order.
 *
 * @param {Array<{ file?: string, category: string, body: string }>} fragments
 * @returns {string}
 */
export function renderFragments(fragments) {
  if (!Array.isArray(fragments)) throw new Error('fragments must be an array')

  const grouped = new Map(CATEGORIES.map(category => [category, []]))
  for (const fragment of fragments) {
    const file = fragment?.file ?? 'fragment'
    if (!fragment || typeof fragment !== 'object')
      throw new Error(`${file}: fragment must be an object`)
    if (!CATEGORIES.includes(fragment.category))
      throw new Error(`${file}: unknown category "${fragment.category}"`)
    if (typeof fragment.body !== 'string')
      throw new Error(`${file}: body is missing`)
    const normalized = normalizeBody(fragment.body)
    if (normalized.trim() === '') throw new Error(`${file}: body is empty`)
    if (HEADING_PATTERN.test(normalized))
      throw new Error(`${file}: body contains a Markdown heading`)
    grouped.get(fragment.category).push(renderEntry(normalized))
  }

  const sections = []
  for (const category of CATEGORIES) {
    const entries = grouped.get(category)
    if (entries.length > 0)
      sections.push(`### ${SECTION_TITLES[category]}\n${entries.join('\n')}`)
  }
  return sections.join('\n\n')
}

function normalizeVersion(version) {
  if (typeof version !== 'string') throw new Error('version must be X.Y.Z or vX.Y.Z')
  const match = VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`invalid version "${version}"; expected X.Y.Z or vX.Y.Z`)
  return `${match[1]}.${match[2]}.${match[3]}`
}

function validateDate(date) {
  if (typeof date !== 'string')
    throw new Error('date must be YYYY-MM-DD')
  const match = DATE_PATTERN.exec(date)
  if (!match) throw new Error(`invalid date "${date}"; expected YYYY-MM-DD`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = new Date(Date.UTC(year, month - 1, day))
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  )
    throw new Error(`invalid date "${date}"; that calendar day does not exist`)
  return date
}

function splitUnreleased(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
  const headingIndex = lines.findIndex(line => UNRELEASED_PATTERN.test(line))
  if (headingIndex === -1) return null

  let nextHeadingIndex = -1
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (RELEASE_HEADING_PATTERN.test(lines[index])) {
      nextHeadingIndex = index
      break
    }
  }

  const contentEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex
  return {
    prefix: lines.slice(0, headingIndex + 1).join('\n'),
    content: lines.slice(headingIndex + 1, contentEnd).join('\n').trim(),
    suffix:
      nextHeadingIndex === -1
        ? ''
        : lines.slice(nextHeadingIndex).join('\n').replace(/\n+$/, ''),
  }
}

function combinePending(content, fragments) {
  const rendered = renderFragments(fragments)
  return [content, rendered].filter(Boolean).join('\n\n')
}

/**
 * Return the body that belongs in the release notes before GitHub's generated
 * pull-request list: curated `## Unreleased` content followed by fragments.
 *
 * @param {string} source current CHANGELOG.md contents
 * @param {Array<{ file?: string, category: string, body: string }>} fragments
 * @returns {string}
 */
export function renderPendingRelease(source, fragments) {
  const split = splitUnreleased(source)
  if (!split)
    throw new Error('CHANGELOG.md must contain a "## Unreleased" heading')
  const errors = fragmentListErrors(fragments)
  if (errors.length > 0)
    throw new Error(`Cannot render invalid fragments:\n${errors.join('\n')}`)
  return combinePending(split.content, fragments)
}

/**
 * Build the next CHANGELOG.md. The existing Unreleased content and the
 * rendered fragments become a dated release under an empty `## Unreleased`.
 * Earlier release text is preserved.
 *
 * @param {string} source
 * @param {string} version
 * @param {string} date
 * @param {Array<{ file?: string, category: string, body: string }>} fragments
 * @returns {string}
 */
export function buildReleaseChangelog(source, version, date, fragments) {
  const normalizedVersion = normalizeVersion(version)
  const normalizedDate = validateDate(date)
  const split = splitUnreleased(source)
  if (!split)
    throw new Error('CHANGELOG.md must contain a "## Unreleased" heading')

  const errors = fragmentListErrors(fragments)
  if (errors.length > 0)
    throw new Error(`Cannot fold invalid fragments:\n${errors.join('\n')}`)

  const combined = combinePending(split.content, fragments)
  if (combined === '')
    throw new Error(
      'Nothing to release: ## Unreleased is empty and there are no fragments',
    )

  const parts = [
    split.prefix.replace(/[ \t\n]+$/, ''),
    `## ${normalizedVersion} — ${normalizedDate}`,
    combined,
  ]
  if (split.suffix) parts.push(split.suffix)
  return `${parts.join('\n\n')}\n`
}

function defaultDate() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Fold fragments and curated Unreleased content into a dated CHANGELOG.md
 * section, then delete only the fragment files that were consumed.
 *
 * @param {{ version: string, date?: string, dir?: string, changelogPath?: string }} options
 * @returns {number} number of fragment files folded and deleted
 */
export function releaseChangelog({
  version,
  date = defaultDate(),
  dir = 'changelog.d',
  changelogPath = 'CHANGELOG.md',
} = {}) {
  const errors = validateFragments(dir)
  if (errors.length > 0)
    throw new Error(`Cannot release with invalid fragments:\n${errors.join('\n')}`)

  const fragments = readFragments(dir)
  const source = readFileSync(changelogPath, 'utf8')
  const output = buildReleaseChangelog(source, version, date, fragments)

  const temporaryPath = `${changelogPath}.${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, output, 'utf8')
    renameSync(temporaryPath, changelogPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }

  for (const fragment of fragments) rmSync(join(dir, fragment.file))
  return fragments.length
}

function usage() {
  return `Usage:
  changelog.mjs check    [dir] [--dir DIR]
  changelog.mjs render   [dir] [--dir DIR]
  changelog.mjs pending  [dir] [--dir DIR] [--changelog FILE]
  changelog.mjs release  <X.Y.Z|vX.Y.Z> [--date YYYY-MM-DD] [--dir DIR] [--changelog FILE]

Commands:
  check    Validate every fragment and report all errors.
  render   Print the fragment sections for the pending release.
  pending  Print curated Unreleased content followed by fragment sections.
  release  Fold Unreleased content and fragments into CHANGELOG.md and delete
           the consumed fragment files.`
}

function parseArguments(argv) {
  const options = {}
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    const option = /^--([a-z-]+)$/.exec(argument)
    if (option) {
      const name = option[1]
      if (!['date', 'dir', 'changelog', 'version'].includes(name))
        throw new Error(`unknown option --${name}`)
      const value = argv[index + 1]
      if (value === undefined || value === '--')
        throw new Error(`--${name} needs a value`)
      options[name] = value
      index += 1
      continue
    }
    if (argument.startsWith('-') && argument !== '-')
      throw new Error(`unknown option ${argument}`)
    positionals.push(argument)
  }
  return { options, positionals }
}

function runCli(argv) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help') {
    console.log(usage())
    return
  }

  const { options, positionals } = parseArguments(rest)

  if (command === 'release') {
    if (positionals.length > 1)
      throw new Error('release accepts one version argument')
    const version = options.version ?? positionals[0]
    if (!version) throw new Error('release needs a version, for example 0.1.17')
    const count = releaseChangelog({
      version,
      date: options.date,
      dir: options.dir,
      changelogPath: options.changelog,
    })
    console.log(
      `Folded ${count} fragment${count === 1 ? '' : 's'} into ${options.changelog ?? 'CHANGELOG.md'}.`,
    )
    return
  }

  if (!['check', 'render', 'pending'].includes(command))
    throw new Error(`unknown command "${command}"\n\n${usage()}`)
  if (positionals.length > 1)
    throw new Error(`${command} accepts at most one directory argument`)

  const dir = options.dir ?? positionals[0] ?? 'changelog.d'
  const errors = validateFragments(dir)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
    return
  }

  const fragments = readFragments(dir)
  if (command === 'check') {
    console.log(
      `${dir}: ${fragments.length} fragment${fragments.length === 1 ? '' : 's'} valid.`,
    )
    return
  }
  if (command === 'render') {
    console.log(renderFragments(fragments))
    return
  }

  const changelogPath = options.changelog ?? 'CHANGELOG.md'
  console.log(renderPendingRelease(readFileSync(changelogPath, 'utf8'), fragments))
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
