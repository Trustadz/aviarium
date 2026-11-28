import type { ComponentType, ReactNode } from 'react'
import type { GameLevel, GameMetadata } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt, PlayOptions } from '../../../packages/game-sdk/src/progress.js'
import type { GameGuide } from './GameGuide.js'
import type { PackPresentation } from './GamePacks.js'
import type { Translate } from './i18n.js'
import type { Message } from './messages.js'
import type { PackStudioProps } from './PackStudio.js'
import type { LocalSession, ProfilePreferences } from './storage.js'

export interface GamePlayerProps {
  /** Present only for a daily-challenge claim. */
  challenge?: { occurrenceId: string; slotId: string; game: string; attemptId: string; endsAt: string
    rules?: Record<string, string | number | boolean | null> }
  /** Optional compact standings block rendered inside the after-game overlay. */
  standingsPanel?: ReactNode
  /** Present when a closed challenge seed is being replayed outside the daily board. */
  replay?: { label: string; backLabel?: string }
  level: GameLevel
  pack?: PackRevision
  session: LocalSession
  preferences: ProfilePreferences
  reader: boolean
  bestMs?: number
  /** Highest completed score for this game, when the game is score-based. */
  bestScore?: number
  testMode?: boolean
  persist: (data: GameAttempt) => Promise<void>
  /** Start a new attempt at a newly generated level, such as "Play again". */
  launch?: (level: GameLevel) => Promise<void> | void
  /** Flush local completions to the server, e.g. before opening the leaderboard. */
  sync?: () => Promise<void>
  leave: () => void
  /** Leave through the canonical progress action (roadmap, menu, or editor). */
  finish?: () => void
  reset: () => void
  openSettings?: () => void
  /** Optional seed/share control rendered in the player navigation. */
  seedShare?: ReactNode
  leaderboard?: { open: () => void }
}

export interface GameMenuContext {
  profile: string
  online: boolean
  canPlay: boolean
  params: URLSearchParams
  preferences: ProfilePreferences
  updatePreferences(patch: Partial<ProfilePreferences>): void
  launch(level: GameLevel, options?: { playOptions?: PlayOptions }): Promise<void>
  perform(run: (() => Promise<unknown>) | (() => unknown)): void
}

/** One player-facing setting exposed by Quick Play and seed review. */
export interface GamePlayOption {
  key: string
  label: Message
  default: boolean
}

/** Game-owned bridge from a shared seed payload to a playable generated level. */
export interface GameSeed {
  generate(seed: string, board: Record<string, unknown>): Promise<GameLevel>
  summary(t: Translate, board: Record<string, unknown>): string
}

/** A short, non-ranking annotation shown beside a leaderboard player name. */
export interface LeaderboardTag {
  label: string
  tone?: 'praise' | 'muted' | 'unknown'
  /** Longer explanation for a tooltip; never required to understand the label. */
  title?: string
}

export interface WebGame extends GameMetadata {
  description: Message
  studioDescription?: Message
  url: string
  theme: string
  /** Optional title decoration (a transparent SVG of the game mascot). */
  mascot?: string
  /** Optional 184px Library card illustration. */
  cardArt?: string
  /** Player-owned presentation options exposed by Quick Play. */
  playOptions?: readonly GamePlayOption[]
  /** Present when the game supports the shared seed review flow. */
  seed?: GameSeed
  guide?: Parameters<typeof GameGuide>[0]['sections']
  packs?: PackPresentation
  /** Omit for games with no authorable packs; such games are hidden from Studio. */
  Studio?: ComponentType<PackStudioProps>
  Player: ComponentType<GamePlayerProps>
  menu?(context: GameMenuContext): ReactNode
  sample?(packs: readonly PackRevision[]): GameLevel | undefined
  preview(level?: GameLevel, attempt?: GameAttempt, thumbnail?: boolean): ReactNode
  levelTitle(t: Translate, level: GameLevel): string
  resultDetail(t: Translate, level: GameLevel | undefined, attempt: GameAttempt): string | undefined
  progress(t: Translate, attempt: GameAttempt): string | undefined
  share?(level: GameLevel): ReactNode
  createAttempt(level: GameLevel, pack?: PackRevision, playOptions?: PlayOptions): Promise<GameAttempt>
  mutationExtras?(level: GameLevel | undefined): Record<string, unknown> | undefined
  favorite?: string
  settings?: { title: Message; toggles: readonly { key: string; label: Message; default: boolean }[] }
  connectMessage: Message
  history: boolean
  leaderboards?: {
    boardHref(level: GameLevel): string
    /** Game-owned annotations for a stored result, such as hints used. */
    tags?(t: Translate, row: LeaderboardStanding): readonly LeaderboardTag[]
  }
}
