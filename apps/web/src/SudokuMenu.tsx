import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { levelTitle, packChapterDescription, packChapterTitle, packDescription, packTitle } from './sudoku-copy.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import { useState } from 'react'
import { difficulties, type Difficulty } from '../../../packages/game-sdk/src/index.js'
import { type GradedPack, type PackRules, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { errorMessage } from './api.js'
import type { PackPresentation } from './GamePacks.js'
import { effectiveChapterRules, type PackChapter, type PackEntry } from '../../../packages/game-sdk/src/packs.js'
import type { PlayOptions } from '../../../packages/game-sdk/src/progress.js'
import type { GameMenuContext } from './game-web.js'
import { QuickPlayCard } from './QuickPlay.js'
import { createQuickPlayLevel } from './quick-play.js'

export function QuickPlay({ canPlay, profile, preferences, updatePreferences, launch }: GameMenuContext) {
  const t = useT()
  const difficultyKey = 'aviarium:sudoku-difficulty:' + profile
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    const saved = localStorage.getItem(difficultyKey)
    return difficulties.find(value => value === saved) ?? 'Medium'
  })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const playOptions: PlayOptions = {
    hints: Boolean(preferences.hints ?? true),
    autoNotes: Boolean(preferences.autoNotes ?? true),
    autoNoteDeletion: Boolean(preferences.autoNoteDeletion ?? true),
    mistakes: Boolean(preferences.mistakes ?? true),
    timer: Boolean(preferences.timer ?? true),
  }
  const options = [
    { key: 'hints', label: t('Hints'), checked: Boolean(playOptions.hints),
      onChange: (checked: boolean) => updatePreferences({ hints: checked }) },
    { key: 'autoNotes', label: t('Auto notes'), checked: Boolean(playOptions.autoNotes),
      onChange: (checked: boolean) => updatePreferences({ autoNotes: checked }) },
    { key: 'autoNoteDeletion', label: t('Remove conflicting notes'), checked: Boolean(playOptions.autoNoteDeletion),
      onChange: (checked: boolean) => updatePreferences({ autoNoteDeletion: checked }) },
    { key: 'mistakes', label: t('Highlight conflicts'), checked: Boolean(playOptions.mistakes),
      onChange: (checked: boolean) => updatePreferences({ mistakes: checked }) },
    { key: 'timer', label: t('Show timer'), checked: Boolean(playOptions.timer),
      onChange: (checked: boolean) => updatePreferences({ timer: checked }) },
  ]
  const summary = [
    t('Hints') + ' ' + (playOptions.hints ? t('On').toLocaleLowerCase() : t('Off').toLocaleLowerCase()),
    t('Auto notes') + ' ' + (playOptions.autoNotes ? t('On').toLocaleLowerCase() : t('Off').toLocaleLowerCase()),
  ].join(' · ')
  return <QuickPlayCard primary={{
    key: 'difficulty', label: t('Difficulty'), value: difficulty,
    choices: difficulties.map(value => ({ value, label: t(value) })),
    disabled: busy,
    onChange: value => {
      const next = difficulties.find(item => item === value)
      if (!next) return
      setDifficulty(next)
      localStorage.setItem(difficultyKey, next)
    },
  }} options={options} summary={summary} actionLabel={t('Start puzzle')}
    busyLabel={t('Preparing puzzle…')} busy={busy} disabled={!canPlay}
    problem={problem ? knownMessage(t, problem) : undefined}
    onSubmit={() => {
      if (!canPlay || busy) return
      setProblem('')
      setBusy(true)
      void createQuickPlayLevel(difficulty)
        .then(level => launch(level, { playOptions }))
        .catch(error => setProblem(errorMessage(error)))
        .finally(() => setBusy(false))
    }}/>
}

type GradedChapter = GradedPack['chapters'][number]

function gradeRange(t: Translate, chapters: readonly GradedChapter[]) {
  const tiers = chapters.flatMap(chapter => chapter.puzzles.map(puzzle => difficulties.indexOf(puzzle.difficulty)))
  if (!tiers.length) return undefined
  const min = Math.min(...tiers), max = Math.max(...tiers)
  return min === max ? t(difficulties[min]) : t(difficulties[min]) + '–' + t(difficulties[max])
}

export function displayTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function ruleLabels(t: Translate, rules: PackRules) {
  return [t(rules.inOrder ? 'In order' : 'Pick & choose'), !rules.hints && t('No hints'),
    !rules.autoNotes && t('No Auto notes'), rules.lives && t('{count, plural, one {# life} other {# lives}}', { count: rules.lives }),
    rules.timeTrial && t('Always show timer'), rules.diagonal && t('Diagonal Sudoku')].filter((label): label is string => typeof label === 'string')
}

export const sudokuPackPresentation: PackPresentation = {
  menuLabel: 'Sudoku menu',

  title: (t, pack) => packTitle(t, pack as PublishedPack),
  description: (t, pack) => packDescription(t, pack as PublishedPack),
  chapterTitle: (t, pack, chapter) => packChapterTitle(t, pack as PublishedPack, chapter),
  chapterDescription: (t, pack, chapter) => packChapterDescription(t, pack as PublishedPack, chapter),
  levelTitle: (t, level) => levelTitle(t, level as PublishedLevel),
  detail: (t, level) => t((level as PublishedLevel).difficulty),
  details: (t, pack) => gradeRange(t, (pack as PublishedPack).data.chapters),
  chapterDetails: (t, _pack, chapter) => gradeRange(t, [chapter as GradedChapter]),
  ruleLabels: (t, _pack, chapter) => ruleLabels(t, chapter.rules as PackRules),
  challenge(t, _pack, chapter, stop) {
    const defaults = chapter.rules as PackRules
    const rules = effectiveChapterRules(chapter as PackChapter<PackEntry, PackRules>, stop)
    return [
      rules.inOrder !== defaults.inOrder && t(rules.inOrder ? 'In order' : 'Pick & choose'),
      rules.hints !== defaults.hints && t(rules.hints ? 'Hints available' : 'No hints'),
      rules.autoNotes !== defaults.autoNotes && t(rules.autoNotes ? 'Auto notes available' : 'No Auto notes'),
      rules.timeTrial !== defaults.timeTrial && t(rules.timeTrial ? 'Always show timer' : 'Use timer preference'),
      Boolean(rules.diagonal) !== Boolean(defaults.diagonal) && t(rules.diagonal ? 'Diagonal Sudoku' : 'Classic Sudoku'),
      rules.lives !== defaults.lives && (rules.lives
        ? t('{count, plural, one {# life} other {# lives}}', { count: rules.lives }) : t('Unlimited lives')),
    ].filter(Boolean).join(' · ')
  },
  bestTime(t, _pack, chapter, stop, completions) {
    if (effectiveChapterRules(chapter as PackChapter<PackEntry, PackRules>, stop).timeTrial && completions.length)
      return t('Best {time}', { time: displayTime(Math.min(...completions.map(save => save.elapsedMs))) })
  },
}
