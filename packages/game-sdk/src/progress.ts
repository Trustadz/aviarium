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

/** Player-selected presentation options captured with a generated attempt. */
export const playOptionValue = z.union([z.boolean(), z.number(), z.string(), z.null()])
export const playOptionsSchema = z.record(z.string(), playOptionValue)
export type PlayOptions = Record<string, boolean | number | string | null>
export const attemptPlayOptions = { playOptions: playOptionsSchema.optional() }

export const attemptHeader = z.object({ game: z.string().min(1).max(64), ...attemptIdentity, ...attemptOutcome,
  ...attemptPlayOptions, packRevision: packRevisionField })
export type GameAttempt = z.infer<typeof attemptHeader> & { lives?: number; aids?: unknown }

export interface SavedAttempt<Attempt extends GameAttempt = GameAttempt> {
  id: string
  revision: number
  data: Attempt
  parentId?: string
  archived: boolean
  updatedAt?: number | null
  /** Present when this save belongs to a daily-challenge claim. */
  challenge?: {
    attemptId: string
    /** Server status after a sync; optional for a locally claimed attempt. */
    status?: 'started' | 'completed' | 'closed'
    ranked?: boolean
    invalid?: boolean
    slotId?: string
    occurrenceId?: string
    endsAt?: string
    game?: string
  }
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
export const challengeMutationField = {
  /** Daily-challenge claim; absent for normal practice/Quick Play. */
  challenge: z.object({ attemptId: z.uuid() }).optional(),
}
export const mutationHeader = z.object({ ...mutationIdentity, data: attemptHeader, ...mutationStatus, ...challengeMutationField })
export type AttemptMutation<Attempt extends GameAttempt = GameAttempt> =
  Omit<z.infer<typeof mutationHeader>, 'data'> & { data: Attempt }

export const levelKey = (level: string, revision: number) => level + ':' + revision
export const savedGameLimit = 5

export function isResumable(attempt: Pick<SavedAttempt, 'data' | 'archived'>) {
  return !attempt.archived && !attempt.data.completed && attempt.data.lives !== 0
}
