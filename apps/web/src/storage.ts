import { Dexie, type EntityTable } from 'dexie'
import type { Locale } from '../../../packages/game-sdk/src/locales.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { PackCompletion, PackDraftRecord, PackRevision } from '../../../packages/game-sdk/src/packs.js'
import { isResumable, levelKey, savedGameLimit, type AttemptMutation, type GameAttempt, type SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
export { isResumable, levelKey } from '../../../packages/game-sdk/src/progress.js'
import { api, json } from './api.js'
import { randomId } from './random.js'

export const localProfile = 'local-play'

type QueuedMutation = AttemptMutation & Record<string, unknown>
export type MutationExtras = (game: string, level: GameLevel | undefined) => Record<string, unknown> | undefined

export type LocalSession<Attempt extends GameAttempt = GameAttempt> = SavedAttempt<Attempt> & {
  profile: string; updated: number; dirty: boolean; sent?: QueuedMutation; expired?: true
}
export type ProfilePreferences = Record<string, string | boolean | number | null | undefined> & { locale?: Locale }
interface LocalPrefs { profile: string; data: ProfilePreferences; pending: Partial<ProfilePreferences>; revision?: number }
interface RemotePreferences { revision: number; data: Partial<ProfilePreferences> }
interface StoredLevel { key: string; level: GameLevel }
interface Completion { key: string; profile: string; level: string; revision: number }
export interface StudioPack {
  key: string
  scope: string
  draft: PackDraftRecord
  dirty: boolean
  localEdit?: string
}
interface StoredPack { key: string; pack: PackRevision }

export const db = new Dexie('aviarium') as Dexie & {
  sessions: EntityTable<LocalSession, 'id'>
  prefs: EntityTable<LocalPrefs, 'profile'>
  levels: EntityTable<StoredLevel, 'key'>
  completions: EntityTable<Completion, 'key'>
  packs: EntityTable<StoredPack, 'key'>
  studioPacks: EntityTable<StudioPack, 'key'>
}
db.version(1).stores({ sessions: 'id,profile', prefs: 'profile', levels: 'key', completions: 'key,profile' })
db.version(2).stores({ packs: 'key' })
db.version(3).stores({ studioPacks: 'key,scope' })

export function packCompletionEvents(completed: ReadonlySet<string>, sessions: readonly SavedAttempt[]): PackCompletion[] {
  const events = sessions.filter(item => item.data.completed).map(({ data }) => ({
    level: data.level, revision: data.levelRevision, packRevision: data.packRevision,
  }))
  const covered = new Set(events.map(item => levelKey(item.level, item.revision)))
  for (const id of completed) {
    if (covered.has(id)) continue
    const separator = id.lastIndexOf(':')
    events.push({ level: id.slice(0, separator), revision: Number(id.slice(separator + 1)), packRevision: undefined })
  }
  return events
}

export async function cacheLevels(levels: GameLevel[]) {
  await db.levels.bulkPut(levels.map(level => ({ key: levelKey(level.id, level.revision), level })))
}

async function trimSavedGames(profile: string) {
  const sessions = (await db.sessions.where('profile').equals(profile).toArray())
    .sort((a, b) => b.updated - a.updated || b.revision - a.revision || b.id.localeCompare(a.id))
  const expired = sessions.filter(isResumable).slice(savedGameLimit)
  for (const session of expired) {
    session.archived = true
    session.dirty = profile !== localProfile
    session.expired = true
  }
  if (expired.length) await db.sessions.bulkPut(expired)
  return sessions
}

export function listSessions(profile: string) {
  return db.transaction('rw', db.sessions, () => trimSavedGames(profile))
}

export function deleteSavedGame(profile: string, id: string) {
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id)
    if (session?.profile === profile && !session.archived)
      await db.sessions.put({ ...session, archived: true, dirty: profile !== localProfile, expired: undefined })
  })
}
export async function saveLocal(session: LocalSession) {
  await db.transaction('rw', db.sessions, async () => {
    const stored = await db.sessions.get(session.id)
    if (stored && stored.profile !== session.profile) throw new Error('This save belongs to another profile.')
    if (stored && (stored.revision !== session.revision || stored.updated > session.updated))
      throw new Error('This attempt changed in another tab. Reopen it before continuing.')
    await db.sessions.put({ ...session, sent: stored?.sent, dirty: session.profile !== localProfile })
    await trimSavedGames(session.profile)
  })
}

// Compare against the snapshot the player actually opened, including same-device edits.
export function writeAttempt(expected: LocalSession, data: LocalSession['data']) {
  return db.transaction('rw', db.sessions, async () => {
    const current = await db.sessions.get(expected.id)
    if (!current || current.profile !== expected.profile || current.archived)
      throw new Error('This saved game was deleted.')
    const concurrent = current.revision !== expected.revision || current.updated !== expected.updated
    const dirty = expected.profile !== localProfile
    const next: LocalSession = concurrent
      ? { ...expected, id: randomId(), parentId: expected.id, revision: 0, sent: undefined,
          updated: Date.now(), data, dirty, archived: false }
      : { ...expected, sent: current?.sent, updated: Math.max(Date.now(), expected.updated + 1), data, dirty }
    await db.sessions.put(next)
    if (concurrent) await trimSavedGames(next.profile)
    return next
  })
}

export async function updatePreferences(profile: string, patch: Partial<ProfilePreferences>) {
  return db.transaction('rw', db.prefs, async () => {
    const current = await db.prefs.get(profile)
    const data = { ...current?.data, ...patch }
    await db.prefs.put({ profile, ...current, data,
      pending: profile === localProfile ? {} : { ...current?.pending, ...patch } })
    return data
  })
}

interface Progress {
  sessions: SavedAttempt[]
  completions: { level: string; revision: number }[]
  prefs: RemotePreferences
  levels: GameLevel[]
}
const synchronizing = new Map<string, Promise<void>>()
export function sync(profile: string, extras: MutationExtras) {
  if (profile === localProfile) return Promise.resolve()
  const current = synchronizing.get(profile)
  if (current) return current
  const pending = synchronize(profile, extras).finally(() => synchronizing.delete(profile))
  synchronizing.set(profile, pending)
  return pending
}

const syncingPreferences = new Map<string, Promise<void>>()
export function syncPreferences(profile: string) {
  const current = syncingPreferences.get(profile)
  if (current) return current
  const pending = sendPreferences(profile).finally(() => syncingPreferences.delete(profile))
  syncingPreferences.set(profile, pending)
  return pending
}

async function sendPreferences(profile: string) {
  while (true) {
    const prefs = await db.prefs.get(profile)
    if (!prefs || !Object.keys(prefs.pending).length) return
    const saved = await api<RemotePreferences>('/preferences', json('PATCH', prefs.pending), profile)
    await db.transaction('rw', db.prefs, async () => {
      const latest = await db.prefs.get(profile)
      if (!latest || saved.revision < (latest.revision ?? 0)) return
      const pending = { ...latest.pending }
      for (const key of Object.keys(prefs.pending) as (keyof ProfilePreferences)[]) {
        if (pending[key] === prefs.pending[key]) delete pending[key]
      }
      await db.prefs.put({ profile, revision: saved.revision, data: { ...saved.data, ...pending }, pending })
    })
  }
}

async function synchronize(profile: string, extras: MutationExtras) {
  // Earlier completions unlock later stops in an ordered pack.
  const dirty = (await listSessions(profile)).filter(session => session.dirty || session.sent).reverse()
  for (const pending of dirty) {
    const mutation = await db.transaction('rw', db.sessions, db.levels, async () => {
      const current = await db.sessions.get(pending.id)
      if (!current?.dirty && !current?.sent) return undefined
      if (current.sent) return current.sent
      const stored = await db.levels.get(levelKey(current.data.level, current.data.levelRevision))
      const mutation: QueuedMutation = { sessionId: current.id, mutationId: randomId(),
        baseRevision: current.revision, data: current.data, archived: current.archived, updatedAt: current.updated,
        archiveIfUnchanged: current.expired, ...extras(current.data.game, stored?.level) }
      await db.sessions.put({ ...current, sent: mutation, dirty: false })
      return mutation
    })
    if (!mutation) continue
    const saved = await api<SavedAttempt>('/progress', json('POST', mutation), profile)
    await db.transaction('rw', db.sessions, async () => {
      const current = await db.sessions.get(mutation.sessionId)
      if (current?.sent?.mutationId !== mutation.mutationId) return
      if (saved.id !== current.id) await db.sessions.delete(current.id)
      await db.sessions.put({
        ...saved, profile, updated: current.dirty ? current.updated : saved.updatedAt ?? current.updated, dirty: current.dirty,
        data: current.dirty ? current.data : saved.data,
        archived: saved.archived || (current.dirty && current.archived),
        expired: current.dirty ? current.expired : undefined,
      })
    })
  }
  await syncPreferences(profile)
  const progress = await api<Progress>('/progress', undefined, profile)
  await cacheLevels(progress.levels)
  await db.transaction('rw', db.sessions, db.prefs, db.completions, async () => {
    for (const remote of progress.sessions) {
      const local = await db.sessions.get(remote.id)
      if (local && (local.revision >= remote.revision || (!remote.archived && (local.dirty || local.sent)))) continue
      await db.sessions.put({ ...remote, profile, updated: remote.updatedAt ?? local?.updated ?? 0, dirty: false })
    }
    await trimSavedGames(profile)
    const current = await db.prefs.get(profile)
    if (progress.prefs.revision >= (current?.revision ?? 0)) {
      await db.prefs.put({ profile, revision: progress.prefs.revision,
        data: { ...progress.prefs.data, ...current?.pending }, pending: current?.pending ?? {} })
    }
    await db.completions.bulkPut(progress.completions.map(completion =>
      ({ ...completion, profile, key: profile + ':' + levelKey(completion.level, completion.revision) })))
  })
}

export function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
