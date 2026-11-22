import type { ComponentType, ReactNode } from 'react'
import type { GameLevel, GameMetadata } from '../../../packages/game-sdk/src/index.js'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt } from '../../../packages/game-sdk/src/progress.js'
import type { GameGuide } from './GameGuide.js'
import type { PackPresentation } from './GamePacks.js'
import type { Translate } from './i18n.js'
import type { Message } from './messages.js'
import type { PackStudioProps } from './PackStudio.js'
import type { LocalSession, ProfilePreferences } from './storage.js'

export interface GamePlayerProps {
  level: GameLevel
  pack?: PackRevision
  session: LocalSession
  preferences: ProfilePreferences
  reader: boolean
  persist: (data: GameAttempt) => Promise<void>
  leave: () => void
  reset: () => void
  openSettings?: () => void
}

export interface GameMenuContext {
  profile: string
  online: boolean
  canPlay: boolean
  params: URLSearchParams
  launch(level: GameLevel): Promise<void>
  perform(run: () => Promise<unknown>): void
}

export interface WebGame extends GameMetadata {
  description: Message
  studioDescription?: Message
  url: string
  theme: string
  guide?: Parameters<typeof GameGuide>[0]['sections']
  packs?: PackPresentation
  Studio?: ComponentType<PackStudioProps>
  Player: ComponentType<GamePlayerProps>
  menu?(context: GameMenuContext): ReactNode
  sample?(levels: readonly GameLevel[]): GameLevel | undefined
  catalog?: string
  preview(level?: GameLevel, attempt?: GameAttempt): ReactNode
  levelTitle(t: Translate, level: GameLevel): string
  resultDetail(t: Translate, level: GameLevel | undefined, attempt: GameAttempt): string | undefined
  progress(t: Translate, attempt: GameAttempt): string | undefined
  share?(level: GameLevel): ReactNode
  createAttempt(level: GameLevel, pack?: PackRevision): Promise<GameAttempt>
  mutationExtras?(level: GameLevel | undefined): Record<string, unknown> | undefined
  favorite?: string
  settings?: { title: Message; toggles: readonly { key: string; label: Message; default: boolean }[] }
  connectMessage: Message
  history: boolean
}
