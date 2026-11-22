import type { ComponentType } from 'react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { PackDocument, PackEntry, PackRevision, ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import type { PackPresentation } from './GamePacks.js'
import type { Translate } from './i18n.js'
import type { Message } from './messages.js'
import type { RuleGroup } from './StudioRuleFields.js'

export interface LevelReview {
  ready: boolean
  status: Message
  detail?: Message
}

export interface StudioEditorProps {
  level: PackEntry
  rules: ProgressionRules
  update(patch: Partial<PackEntry>): void
  trial(): void
  onCheck(key: string, review: LevelReview): void
}

export interface StudioTrialProps {
  level: GameLevel
  pack: PackRevision
  profile: string
  reader: boolean
  leave(): void
}

export interface StudioGame {
  id: string
  title: string
  theme: string
  themes: readonly { id: string; name: Message }[]
  rules: readonly RuleGroup[]
  presentation: PackPresentation
  createPack(title: string): PackDocument
  createLevel(t: Translate, previous?: PackEntry): PackEntry
  accepts(input: PackDocument): boolean
  sameLevel(entry: PackEntry, rules: ProgressionRules, earlier: PackEntry, earlierRules: ProgressionRules): boolean
  checkKey(entry: PackEntry, rules: ProgressionRules): string
  check(entry: PackEntry, rules: ProgressionRules, signal: AbortSignal): Promise<LevelReview>
  verified(entry: PackEntry): LevelReview
  preview(entry: PackEntry, rules: ProgressionRules, review?: LevelReview): PackEntry
  legacyDrafts?(id: string, signal: AbortSignal): Promise<PackEntry[]>
  Editor: ComponentType<StudioEditorProps>
  Trial: ComponentType<StudioTrialProps>
}
