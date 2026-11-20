import { Dexie, type EntityTable } from 'dexie'
import { z } from 'zod'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { defaults, preferenceSchema, saveSchema, type Mutation, type Preferences, type StoredSession } from '../../../packages/sudoku/src/contracts.js'
import { rules } from '../../../packages/sudoku/src/rules.js'
import { api, json } from './api.js'

export type LocalSession = StoredSession & { profile: string; updated: number; dirty: boolean; sent?: Mutation }
interface LocalPrefs { profile: string; data: Preferences; pending: Partial<Preferences> }
interface StoredLevel { key: string; level: PublishedLevel }
interface Completion { key: string; profile: string; level: string; revision: number }

export const db = new Dexie('aviarium') as Dexie & {
  sessions: EntityTable<LocalSession, 'id'>
  prefs: EntityTable<LocalPrefs, 'profile'>
  levels: EntityTable<StoredLevel, 'key'>
  completions: EntityTable<Completion, 'key'>
}
db.version(1).stores({ sessions: 'id,profile', prefs: 'profile', levels: 'key', completions: 'key,profile' })

export const levelKey = (level: string, revision: number) => level + ':' + revision
export async function cacheLevels(levels: PublishedLevel[]) {
  await db.levels.bulkPut(levels.map(level => ({ key: levelKey(level.id, level.revision), level })))
}

export async function listSessions(profile: string) {
  return (await db.sessions.where('profile').equals(profile).toArray()).sort((a, b) => b.updated - a.updated)
}
export async function saveLocal(session: LocalSession) {
  await db.transaction('rw', db.sessions, async () => {
    const stored = await db.sessions.get(session.id)
    if (stored && stored.profile !== session.profile) throw new Error('This save belongs to another profile.')
    if (stored && (stored.revision !== session.revision || stored.updated > session.updated))
      throw new Error('This attempt changed in another tab. Reopen it before continuing.')
    await db.sessions.put({ ...session, sent: stored?.sent, dirty: true })
  })
}

// Compare against the snapshot the player actually opened, including same-device edits.
export function writeAttempt(expected: LocalSession, data: LocalSession['data']) {
  return db.transaction('rw', db.sessions, async () => {
    const current = await db.sessions.get(expected.id)
    const concurrent = current && (current.profile !== expected.profile ||
      current.revision !== expected.revision || current.updated !== expected.updated || current.archived)
    const next: LocalSession = concurrent
      ? { ...expected, id: crypto.randomUUID(), parentId: expected.id, revision: 0, sent: undefined,
          updated: Date.now(), data, dirty: true, archived: false }
      : { ...expected, sent: current?.sent, updated: Math.max(Date.now(), expected.updated + 1), data, dirty: true }
    await db.sessions.put(next)
    return next
  })
}

export async function updatePreferences(profile: string, patch: Partial<Preferences>) {
  return db.transaction('rw', db.prefs, async () => {
    const current = await db.prefs.get(profile)
    const data = { ...defaults, ...current?.data, ...patch }
    await db.prefs.put({ profile, data, pending: profile === 'guest' ? {} : { ...current?.pending, ...patch } })
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
  if (profile === 'guest') return Promise.resolve()
  const current = synchronizing.get(profile)
  if (current) return current
  const pending = synchronize(profile).finally(() => synchronizing.delete(profile))
  synchronizing.set(profile, pending)
  return pending
}

async function synchronize(profile: string) {
  const dirty = (await listSessions(profile)).filter(session => session.dirty || session.sent)
  for (const pending of dirty) {
    const mutation = await db.transaction('rw', db.sessions, async () => {
      const current = await db.sessions.get(pending.id)
      if (!current?.dirty && !current?.sent) return undefined
      if (current.sent) return current.sent
      const mutation: Mutation = { sessionId: current.id, mutationId: crypto.randomUUID(),
        baseRevision: current.revision, data: current.data, archived: current.archived }
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
        ...saved, profile, updated: current.updated, dirty: current.dirty,
        data: current.dirty ? current.data : saved.data,
        archived: current.dirty ? current.archived : saved.archived,
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
      if (local?.dirty || local?.sent || local && local.revision >= remote.revision) continue
      await db.sessions.put({ ...remote, profile, updated: local?.updated ?? Date.now(), dirty: false })
    }
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

export async function exportProfile(profile: string) {
  const sessions = (await listSessions(profile)).map(({ data, archived }) => ({ data, archived }))
  const prefs = (await db.prefs.get(profile))?.data
  downloadFile('aviarium-data.json', JSON.stringify({ format: 1, sessions, prefs }, null, 2))
}

const exportSchema = z.object({
  format: z.literal(1),
  sessions: z.array(z.object({ data: saveSchema, archived: z.boolean() })).max(500),
  prefs: preferenceSchema.optional(),
})
export async function importProfile(profile: string, file: File) {
  if (file.size > 10_000_000) throw new Error('Select an Aviarium export under 10 MB.')
  const payload = exportSchema.parse(JSON.parse(await file.text()))
  await db.transaction('rw', db.sessions, db.prefs, db.levels, async () => {
    const imported = []
    for (const session of payload.sessions) {
      const { data } = session
      const stored = await db.levels.get(levelKey(data.level, data.levelRevision))
      if (!stored || stored.level.ruleset !== data.ruleset) throw new Error('Download the matching puzzles before importing these saves.')
      const givens = Array.from(stored.level.grid, Number)
      const changesGivens = [data.board, ...data.undo, ...data.redo].some(board =>
        givens.some((value, cell) => value && value !== board.entries[cell]))
      if (changesGivens || data.completed && !rules.verify(givens, data.board.entries))
        throw new Error('A saved attempt contains an invalid board.')
      imported.push({
        ...session, id: crypto.randomUUID(), revision: 0, profile, updated: Date.now(), dirty: true,
      })
    }
    await db.sessions.bulkAdd(imported)
    if (payload.prefs) await updatePreferences(profile, payload.prefs)
  })
  return payload.sessions.length
}
