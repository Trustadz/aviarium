import { z } from 'zod'

export const attemptIdentity = {
  level: z.string().min(1).max(64),
  levelRevision: z.number().int().positive(),
  ruleset: z.number().int().positive(),
  format: z.number().int().positive(),
}

export const attemptOutcome = {
  elapsedMs: z.number().int().min(0).max(365 * 86400_000),
  completed: z.boolean(),
  completedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}

export const packRevisionField = z.number().int().positive().optional()

export const attemptHeader = z.object({ game: z.string().min(1).max(64), ...attemptIdentity, ...attemptOutcome, packRevision: packRevisionField })
export type GameAttempt = z.infer<typeof attemptHeader> & { lives?: number; aids?: unknown }

export interface SavedAttempt<Attempt extends GameAttempt = GameAttempt> {
  id: string
  revision: number
  data: Attempt
  parentId?: string
  archived: boolean
  updatedAt?: number | null
}

export const mutationIdentity = {
  mutationId: z.uuid(), sessionId: z.uuid(), baseRevision: z.number().int().nonnegative(),
}
export const mutationStatus = {
  archived: z.boolean(), updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  archiveIfUnchanged: z.literal(true).optional(),
  /** Test deployments only: backdate the leaderboard posting time for seeded data. */
  seedRecordedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}
export const mutationHeader = z.object({ ...mutationIdentity, data: attemptHeader, ...mutationStatus })
export type AttemptMutation<Attempt extends GameAttempt = GameAttempt> =
  Omit<z.infer<typeof mutationHeader>, 'data'> & { data: Attempt }

export const levelKey = (level: string, revision: number) => level + ':' + revision
export const savedGameLimit = 5

export function isResumable(attempt: Pick<SavedAttempt, 'data' | 'archived'>) {
  return !attempt.archived && !attempt.data.completed && attempt.data.lives !== 0
}
