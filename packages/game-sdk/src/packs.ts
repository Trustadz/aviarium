import { z } from 'zod'

export const packImageBytes = 512 * 1024
export const packUploadBytes = 1200 * 1024
export const packLevelLimit = 30
export const maxPackManifestBytes = 128 * 1024

export const progressionRules = z.object({ inOrder: z.boolean() })
export type ProgressionRules = z.infer<typeof progressionRules>

export const packLevelFields = {
  title: z.string().trim().min(1).max(100),
  ruleset: z.number().int().positive(),
  levelId: z.string().max(64).regex(/^[a-z0-9:-]+$/).optional(),
  levelRevision: z.number().int().positive().optional(),
  chapter: z.string().trim().max(80).optional(),
  introduction: z.string().trim().max(300).optional(),
}
export interface PackEntry extends z.infer<z.ZodObject<typeof packLevelFields>> {
  rules?: object
}

export interface PackDocument<Entry extends PackEntry = PackEntry, Rules extends ProgressionRules = ProgressionRules> {
  format: 1
  game: string
  title: string
  description: string
  theme: string
  rules: Rules
  puzzles: Entry[]
  cover?: string
  background?: string
}

export interface PackDraftRecord<Data extends PackDocument = PackDocument> {
  id: string
  version: number
  published: number | null
  visible: boolean
  data: Data
  ownerName?: string
  lastEditedBy?: string
}

export interface PackRevision<Data extends PackDocument = PackDocument> {
  id: string
  revision: number
  builtIn: boolean
  data: Data
  ownedByViewer?: boolean
  history?: PackPath[]
}

export interface PackPath {
  revision: number
  stops: { id: string; revision: number; inOrder: boolean }[]
}

export interface PackCompletion {
  level: string
  revision: number
  packRevision?: number
}

const image = z.string().max(Math.ceil(packImageBytes / 3) * 4 + 32)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
export const packArtworkFields = { cover: image.optional(), background: image.optional() }
export const packHeaderFields = {
  format: z.literal(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(420),
}

export function definePackSchemas<
  const Id extends string, Theme extends z.ZodType<string>, Rules extends z.ZodType<ProgressionRules>,
  Entry extends z.ZodType<PackEntry>, Verified extends z.ZodType<PackEntry>,
>(game: Id, theme: Theme, rules: Rules, level: Entry, verified: Verified) {
  const manifest = z.object({ ...packHeaderFields, game: z.literal(game), theme, rules, puzzles: z.array(level).max(packLevelLimit) })
  return {
    manifest,
    draft: manifest.extend(packArtworkFields),
    published: manifest.extend({ ...packArtworkFields, puzzles: z.array(verified).min(1).max(packLevelLimit) }),
  }
}

export const packLevelId = (id: string, stop: number) => 'pack:' + id + ':' + stop

export function authoringPack<T extends PackDocument>(data: T): T {
  return { ...data, puzzles: data.puzzles.map(puzzle => {
    if (!puzzle.rules || !('inOrder' in puzzle.rules)) return puzzle
    const { inOrder: _legacy, ...rules } = puzzle.rules
    return { ...puzzle, rules: Object.keys(rules).length ? rules : undefined }
  }) }
}

export function effectivePackRules<R extends ProgressionRules>(pack: PackRevision<PackDocument<PackEntry, R>>, stop: number): R {
  return { ...pack.data.rules, ...pack.data.puzzles[stop - 1]?.rules }
}

export function packProgressPath(pack: PackRevision): PackPath {
  return { revision: pack.revision, stops: pack.data.puzzles.map((entry, index) => ({
    id: entry.levelId ?? packLevelId(pack.id, index + 1), revision: entry.levelRevision ?? pack.revision,
    inOrder: entry.rules && 'inOrder' in entry.rules && typeof entry.rules.inOrder === 'boolean'
      ? entry.rules.inOrder : pack.data.rules.inOrder,
  })) }
}

export function assignPackLevels<E extends PackEntry, R extends ProgressionRules>(
  pack: PackRevision<PackDocument<E, R>>, previous: PackRevision<PackDocument<E, R>> | undefined,
  same: (entry: E, rules: R, prior: E, priorRules: R) => boolean,
): E[] | undefined {
  const previousStops = previous ? packProgressPath(previous).stops : []
  const seen = new Set<string>()
  const levels: E[] = []
  for (const [index, entry] of pack.data.puzzles.entries()) {
    const id = entry.levelId ?? (previous?.data.puzzles[index]?.levelId === undefined && previousStops[index]
      ? previousStops[index].id : packLevelId(pack.id, index + 1))
    const oldIndex = previousStops.findIndex(stop => stop.id === id)
    if ((!id.startsWith('pack:' + pack.id + ':') && oldIndex < 0) || seen.has(id)) return
    seen.add(id)
    const prior = previous?.data.puzzles[oldIndex]
    const unchanged = previous && prior && same(entry, effectivePackRules(pack, index + 1), prior, effectivePackRules(previous, oldIndex + 1))
    levels.push({ ...entry, levelId: id, levelRevision: unchanged ? previousStops[oldIndex].revision : pack.revision })
  }
  return levels
}

export function packProgress(pack: PackRevision, completions: readonly PackCompletion[]) {
  const current = packProgressPath(pack)
  const key = (id: string, revision: number) => id + ':' + revision
  const completed = new Set(completions.map(item => key(item.level, item.revision)))
  const historicIds = new Set((pack.history ?? []).flatMap(path => path.stops.map(stop => stop.id)))
  const byPath = new Map<number, Set<string>>()
  for (const item of completions) {
    if (!historicIds.has(item.level)) continue
    const revision = item.packRevision ?? item.revision
    const entries = byPath.get(revision) ?? new Set<string>()
    entries.add(key(item.level, item.revision))
    byPath.set(revision, entries)
  }
  let earned = new Set<string>()
  for (const previous of pack.history ?? []) {
    const finishedHere = byPath.get(previous.revision)
    if (!finishedHere?.size && !earned.size) continue
    let reached = -1
    previous.stops.forEach((stop, index) => {
      if (earned.has(stop.id) || finishedHere?.has(key(stop.id, stop.revision))) reached = index
      const predecessor = previous.stops[index - 1]
      if (predecessor && finishedHere?.has(key(predecessor.id, predecessor.revision))) reached = index
    })
    if (reached >= 0) earned = new Set([...earned, ...previous.stops.slice(0, reached + 1).map(stop => stop.id)])
  }
  const frontier = current.stops.findLastIndex(stop => earned.has(stop.id))
  const solved = current.stops.map(stop => completed.has(key(stop.id, stop.revision)))
  const playable = current.stops.map((stop, index) => !stop.inOrder || index === 0 || index <= frontier || solved[index] || solved[index - 1])
  const next = playable.findLastIndex((open, index) => open && !solved[index] &&
    (index === 0 || solved[index - 1]) && (index > frontier || index === frontier))
  return { solved, playable, next: next >= 0 ? next : playable.findIndex((open, index) => open && !solved[index]) }
}
