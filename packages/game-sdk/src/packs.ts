import { z } from 'zod'

export const packImageBytes = 512 * 1024
export const packUploadBytes = 16 * 1024 * 1024
export const packLevelLimit = 30
export const packChapterLimit = 12
export const maxPackManifestBytes = 512 * 1024

export const progressionRules = z.object({ inOrder: z.boolean() })
export type ProgressionRules = z.infer<typeof progressionRules>

export const packLevelFields = {
  title: z.string().trim().min(1).max(100),
  ruleset: z.number().int().positive(),
  levelId: z.string().max(64).regex(/^[a-z0-9:-]+$/).optional(),
  levelRevision: z.number().int().positive().optional(),
  introduction: z.string().trim().max(300).optional(),
}
export interface PackEntry extends z.infer<z.ZodObject<typeof packLevelFields>> {
  rules?: object
}

export interface PackChapter<Entry extends PackEntry = PackEntry, Rules extends ProgressionRules = ProgressionRules> {
  id: string
  title: string
  description: string
  theme: string
  rules: Rules
  puzzles: Entry[]
  cover?: string
  background?: string
}

export interface PackDocument<Entry extends PackEntry = PackEntry, Rules extends ProgressionRules = ProgressionRules> {
  format: 2
  game: string
  title: string
  description: string
  chapters: PackChapter<Entry, Rules>[]
  cover?: string
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

export interface PackStop {
  id: string
  revision: number
  inOrder: boolean
  chapter: string
  chapterIndex: number
  chapterStop: number
  stop: number
}

export interface PackPath {
  revision: number
  stops: PackStop[]
}

export interface PackCompletion {
  level: string
  revision: number
  packRevision?: number
}

export interface PackProgress {
  solved: boolean[]
  playable: boolean[]
  next: number
}

export interface ChapterProgress extends PackProgress {
  id: string
  title: string
  completed: number
  total: number
  complete: boolean
  /** Chapters unlock in order: every earlier chapter must be complete. */
  unlocked: boolean
}

const image = z.string().max(Math.ceil(packImageBytes / 3) * 4 + 32)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
export const packArtworkFields = { cover: image.optional(), background: image.optional() }
export const packHeaderFields = {
  format: z.literal(2),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(420),
}

export function definePackSchemas<
  const Id extends string, Theme extends z.ZodType<string>, Rules extends z.ZodType<ProgressionRules>,
  Entry extends z.ZodType<PackEntry>, Verified extends z.ZodType<PackEntry>,
>(game: Id, theme: Theme, rules: Rules, level: Entry, verified: Verified) {
  const chapterFields = {
    id: z.string().max(64).regex(/^[a-z0-9-]+$/),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(420),
    theme,
    rules,
  }
  const chapter = <P extends z.ZodType<PackEntry>>(puzzles: P, min = 0) => z.object({
    ...chapterFields, puzzles: z.array(puzzles).min(min).max(packLevelLimit),
  })
  const chapterDraft = <P extends z.ZodType<PackEntry>>(puzzles: P, min = 0) => chapter(puzzles, min).extend(packArtworkFields)
  const pack = <C extends z.ZodTypeAny>(chapters: C) => z.object({
    ...packHeaderFields, game: z.literal(game), chapters: z.array(chapters).min(1).max(packChapterLimit),
  })
  return {
    manifest: pack(chapter(level)),
    draft: pack(chapterDraft(level)).extend({ cover: image.optional() }),
    published: pack(chapterDraft(verified, 1)).extend({ cover: image.optional() }),
  }
}

export const packLevelId = (packId: string, chapterId: string, stop: number) =>
  'pack:' + packId + ':' + chapterId + ':' + stop

/** The identity used before chapters were introduced. */
export const legacyPackLevelId = (packId: string, stop: number) => 'pack:' + packId + ':' + stop

/**
 * Reads a format 1 document as its single-chapter equivalent. Existing packs
 * therefore keep working as one chapter without changing level identities.
 */
export function upgradePackDocument(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const document = input as Record<string, unknown>
  if (document.format === 2 || Array.isArray(document.chapters)) return input
  if (document.format !== 1 || !Array.isArray(document.puzzles)) return input
  const title = typeof document.title === 'string' ? document.title : 'Chapter 1'
  const description = typeof document.description === 'string' ? document.description : ''
  const cover = typeof document.cover === 'string' ? document.cover : undefined
  const background = typeof document.background === 'string' ? document.background : undefined
  return {
    format: 2, game: document.game, title, description,
    ...(cover ? { cover } : {}),
    chapters: [{
      id: 'chapter-1', title, description,
      theme: typeof document.theme === 'string' ? document.theme : 'default',
      rules: document.rules,
      ...(cover ? { cover } : {}),
      ...(background ? { background } : {}),
      puzzles: document.puzzles,
    }],
  }
}

/** Upgrade a cached pack revision left behind by an older web app. */
export function upgradePackRevision<T extends PackRevision>(pack: T): T {
  const data = upgradePackDocument(pack.data) as T['data']
  return data === pack.data ? pack : { ...pack, data }
}

export function authoringPack<T extends PackDocument>(data: T): T {
  return { ...data, chapters: data.chapters.map(chapter => ({
    ...chapter,
    puzzles: chapter.puzzles.map(puzzle => {
      if (!puzzle.rules || !('inOrder' in puzzle.rules)) return puzzle
      const { inOrder: _legacy, ...rules } = puzzle.rules
      return { ...puzzle, rules: Object.keys(rules).length ? rules : undefined }
    }),
  })) }
}

export function effectiveChapterRules<Entry extends PackEntry, Rules extends ProgressionRules>(
  chapter: PackChapter<Entry, Rules>, stop: number,
): Rules {
  return { ...chapter.rules, ...chapter.puzzles[stop - 1]?.rules as Partial<Rules> }
}

export function packStopAt<Entry extends PackEntry, Rules extends ProgressionRules>(
  pack: Pick<PackRevision<PackDocument<Entry, Rules>>, 'data'>, stop: number,
): { chapter: PackChapter<Entry, Rules>; chapterIndex: number; chapterStop: number; stop: number; entry: Entry } | undefined {
  let index = 0
  for (const [chapterIndex, chapter] of pack.data.chapters.entries()) {
    for (const [chapterStop, entry] of chapter.puzzles.entries()) {
      index += 1
      if (index === stop) return { chapter, chapterIndex, chapterStop: chapterStop + 1, stop, entry }
    }
  }
}

export function effectivePackRules<Entry extends PackEntry, Rules extends ProgressionRules>(
  pack: Pick<PackRevision<PackDocument<Entry, Rules>>, 'data'>, stop: number,
): Rules {
  const location = packStopAt(pack, stop)
  return location ? effectiveChapterRules(location.chapter, location.chapterStop) : pack.data.chapters[0].rules as Rules
}

export function packTheme(pack: Pick<PackRevision, 'data'>) {
  return pack.data.chapters[0]?.theme ?? 'default'
}

export function packCover(pack: Pick<PackRevision, 'data'>) {
  return pack.data.cover ?? pack.data.chapters[0]?.cover
}

export function packLevelCount(pack: Pick<PackRevision, 'data'>) {
  return pack.data.chapters.reduce((total, chapter) => total + chapter.puzzles.length, 0)
}

export function packProgressPath(pack: PackRevision): PackPath {
  const stops: PackStop[] = []
  let stop = 0
  for (const [chapterIndex, chapter] of pack.data.chapters.entries()) {
    for (const [chapterStop, entry] of chapter.puzzles.entries()) {
      stop += 1
      stops.push({
        id: entry.levelId ?? packLevelId(pack.id, chapter.id, chapterStop + 1),
        revision: entry.levelRevision ?? pack.revision,
        inOrder: entry.rules && 'inOrder' in entry.rules && typeof entry.rules.inOrder === 'boolean'
          ? entry.rules.inOrder : chapter.rules.inOrder,
        chapter: chapter.id, chapterIndex, chapterStop: chapterStop + 1, stop,
      })
    }
  }
  return { revision: pack.revision, stops }
}

export function assignPackLevels<Entry extends PackEntry, Rules extends ProgressionRules>(
  pack: PackRevision<PackDocument<Entry, Rules>>, previous: PackRevision<PackDocument<Entry, Rules>> | undefined,
  same: (entry: Entry, rules: Rules, prior: Entry, priorRules: Rules) => boolean,
): PackChapter<Entry, Rules>[] | undefined {
  const previousPath = previous ? packProgressPath(previous) : undefined
  const priorLevels = new Map<string, { entry: Entry; rules: Rules; revision: number }>()
  if (previous && previousPath) {
    let index = 0
    for (const chapter of previous.data.chapters) {
      for (const [chapterStop, entry] of chapter.puzzles.entries()) {
        const stop = previousPath.stops[index++]
        priorLevels.set(stop.id, { entry, rules: effectiveChapterRules(chapter, chapterStop + 1), revision: stop.revision })
      }
    }
  }
  const seen = new Set<string>()
  const chapters: PackChapter<Entry, Rules>[] = []
  for (const chapter of pack.data.chapters) {
    const previousChapter = previous?.data.chapters.find(item => item.id === chapter.id)
    const puzzles: Entry[] = []
    for (const [index, entry] of chapter.puzzles.entries()) {
      const previousEntry = previousChapter?.puzzles[index]
      const previousStop = previousPath?.stops.find(stop => stop.chapter === chapter.id && stop.chapterStop === index + 1)
      const id = entry.levelId ?? (previousEntry?.levelId === undefined && previousStop
        ? previousStop.id : packLevelId(pack.id, chapter.id, index + 1))
      const prior = priorLevels.get(id)
      if ((!id.startsWith('pack:' + pack.id + ':') && !prior) || seen.has(id)) return
      seen.add(id)
      const unchanged = previous && prior && same(entry, effectiveChapterRules(chapter, index + 1), prior.entry, prior.rules)
      puzzles.push({ ...entry, levelId: id, levelRevision: unchanged ? prior.revision : pack.revision })
    }
    chapters.push({ ...chapter, puzzles })
  }
  return chapters
}

function progressForChapter(pack: PackRevision, completions: readonly PackCompletion[], chapterId: string): PackProgress {
  const current = packProgressPath(pack).stops.filter(stop => stop.chapter === chapterId)
  const key = (id: string, revision: number) => id + ':' + revision
  const completed = new Set(completions.map(item => key(item.level, item.revision)))
  const history = (pack.history ?? []).map(path => ({
    revision: path.revision, stops: path.stops.filter(stop => stop.chapter === chapterId),
  }))
  const historicIds = new Set(history.flatMap(path => path.stops.map(stop => stop.id)))
  const byPath = new Map<number, Set<string>>()
  for (const item of completions) {
    if (!historicIds.has(item.level)) continue
    const revision = item.packRevision ?? item.revision
    const entries = byPath.get(revision) ?? new Set<string>()
    entries.add(key(item.level, item.revision))
    byPath.set(revision, entries)
  }
  let earned = new Set<string>()
  for (const previous of history) {
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
  const frontier = current.findLastIndex(stop => earned.has(stop.id))
  const solved = current.map(stop => completed.has(key(stop.id, stop.revision)))
  const playable = current.map((stop, index) => !stop.inOrder || index === 0 || index <= frontier || solved[index] || solved[index - 1])
  const next = playable.findLastIndex((open, index) => open && !solved[index] &&
    (index === 0 || solved[index - 1]) && (index > frontier || index === frontier))
  return { solved, playable, next: next >= 0 ? next : playable.findIndex((open, index) => open && !solved[index]) }
}

/**
 * Progress within one chapter. Chapters are independent, so every chapter
 * starts with its first stop available. Omitting the chapter combines every
 * chapter for pack-level counts.
 */
export function packProgress(pack: PackRevision, completions: readonly PackCompletion[], chapterId?: string): PackProgress {
  if (chapterId !== undefined) return progressForChapter(pack, completions, chapterId)
  const solved: boolean[] = []
  const playable: boolean[] = []
  let next = -1
  let offset = 0
  let earlierComplete = true
  for (const chapter of pack.data.chapters) {
    const progress = progressForChapter(pack, completions, chapter.id)
    const chapterComplete = progress.solved.length > 0 && progress.solved.every(Boolean)
    solved.push(...progress.solved)
    playable.push(...progress.playable.map(open => open && earlierComplete))
    if (next < 0 && earlierComplete && progress.next >= 0) next = offset + progress.next
    earlierComplete = earlierComplete && chapterComplete
    offset += chapter.puzzles.length
  }
  return { solved, playable, next }
}

function chapterProgressAt(pack: PackRevision, completions: readonly PackCompletion[], chapterIndex: number): ChapterProgress {
  const chapter = pack.data.chapters[chapterIndex]
  const progress = packProgress(pack, completions, chapter.id)
  const completed = progress.solved.filter(Boolean).length
  const unlocked = chapterIndex === 0 ||
    pack.data.chapters.slice(0, chapterIndex).every((_, index) => chapterProgressAt(pack, completions, index).complete)
  return {
    id: chapter.id, title: chapter.title, ...progress,
    playable: progress.playable.map(open => open && unlocked),
    completed, total: chapter.puzzles.length, complete: chapter.puzzles.length > 0 && completed === chapter.puzzles.length,
    unlocked,
  }
}

export function chapterProgress(pack: PackRevision, completions: readonly PackCompletion[], chapterId: string): ChapterProgress {
  const chapterIndex = pack.data.chapters.findIndex(item => item.id === chapterId)
  if (chapterIndex < 0) {
    return { id: chapterId, title: '', solved: [], playable: [], next: -1, completed: 0, total: 0, complete: false, unlocked: false }
  }
  return chapterProgressAt(pack, completions, chapterIndex)
}
