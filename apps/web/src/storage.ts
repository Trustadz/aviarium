import { Dexie, type EntityTable } from 'dexie'
import { savedGameLimit, type PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { defaults, type Mutation, type Preferences, type StoredSession } from '../../../packages/sudoku/src/contracts.js'
import type { PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { api, json } from './api.js'

export const localProfile = 'local-play'

export type LocalSession = StoredSession & {
  profile: string; updated: number; dirty: boolean; sent?: Mutation; expired?: true
}
interface LocalPrefs { profile: string; data: Preferences; pending: Partial<Preferences> }
interface StoredLevel { key: string; level: PublishedLevel }
interface Completion { key: string; profile: string; level: string; revision: number }
interface StoredPack { key: string; pack: PublishedPack }

export const db = new Dexie('aviarium') as Dexie & {
  sessions: EntityTable<LocalSession, 'id'>
  prefs: EntityTable<LocalPrefs, 'profile'>
  levels: EntityTable<StoredLevel, 'key'>
  completions: EntityTable<Completion, 'key'>
  packs: EntityTable<StoredPack, 'key'>
}
db.version(1).stores({ sessions: 'id,profile', prefs: 'profile', levels: 'key', completions: 'key,profile' })
db.version(2).stores({ packs: 'key' })

export const levelKey = (level: string, revision: number) => level + ':' + revision
export async function cacheLevels(levels: PublishedLevel[]) {
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

export const isResumable = (session: LocalSession) =>
  !session.archived && !session.data.completed && session.data.lives !== 0

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
      ? { ...expected, id: crypto.randomUUID(), parentId: expected.id, revision: 0, sent: undefined,
          updated: Date.now(), data, dirty, archived: false }
      : { ...expected, sent: current?.sent, updated: Math.max(Date.now(), expected.updated + 1), data, dirty }
    await db.sessions.put(next)
    if (concurrent) await trimSavedGames(next.profile)
    return next
  })
}

export async function updatePreferences(profile: string, patch: Partial<Preferences>) {
  return db.transaction('rw', db.prefs, async () => {
    const current = await db.prefs.get(profile)
    const data = { ...defaults, ...current?.data, ...patch }
    await db.prefs.put({ profile, data, pending: profile === localProfile ? {} : { ...current?.pending, ...patch } })
    return data
  })
}

interface Progress {
  sessions: StoredSession[]
  completions: { level: string; revision: number }[]
  prefs: { data: Partial<Preferences> }
  levels: PublishedLevel[]
}
const synchronizing = new Map<string, Promise<void>>()
export function sync(profile: string) {
  if (profile === localProfile) return Promise.resolve()
  const current = synchronizing.get(profile)
  if (current) return current
  const pending = synchronize(profile).finally(() => synchronizing.delete(profile))
  synchronizing.set(profile, pending)
  return pending
}

async function synchronize(profile: string) {
  // Earlier completions unlock later stops in an ordered pack.
  const dirty = (await listSessions(profile)).filter(session => session.dirty || session.sent).reverse()
  for (const pending of dirty) {
    const mutation = await db.transaction('rw', db.sessions, async () => {
      const current = await db.sessions.get(pending.id)
      if (!current?.dirty && !current?.sent) return undefined
      if (current.sent) return current.sent
      const mutation: Mutation = { sessionId: current.id, mutationId: crypto.randomUUID(),
        baseRevision: current.revision, data: current.data, archived: current.archived, updatedAt: current.updated,
        archiveIfUnchanged: current.expired }
      await db.sessions.put({ ...current, sent: mutation, dirty: false })
      return mutation
    })
    if (!mutation) continue
    const saved = await api<StoredSession>('/progress', json('POST', mutation), profile)
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
  const prefs = await db.prefs.get(profile)
  if (prefs && Object.keys(prefs.pending).length) {
    await api('/preferences', json('PATCH', prefs.pending), profile)
    await db.transaction('rw', db.prefs, async () => {
      const latest = await db.prefs.get(profile)
      if (!latest) return
      const pending = { ...latest.pending }
      for (const key of Object.keys(prefs.pending) as (keyof Preferences)[]) {
        if (pending[key] === prefs.pending[key]) delete pending[key]
      }
      await db.prefs.put({ ...latest, pending })
    })
  }
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
    await db.prefs.put({ profile, data: { ...defaults, ...progress.prefs.data, ...current?.pending }, pending: current?.pending ?? {} })
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
