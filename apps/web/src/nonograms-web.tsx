import { lazy, useState } from 'react'
import {
  createNonogramAttempt, gridSizeSchema, nonogramsId, quickNonogram, quickDescriptor,
  type NonogramLevel, type NonogramSave,
} from '../../../packages/nonograms/src/contracts.js'
import { randomDifficulties, randomSizes, type RandomOptions } from '../../../packages/nonograms/src/puzzles.js'
import { nonogramBoardKey } from '../../../packages/nonograms/src/leaderboards.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import { randomId } from './random.js'
import type { GameMenuContext, WebGame } from './game-web.js'
import { QuickPlayCard } from './QuickPlay.js'
import type { PackPresentation } from './GamePacks.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { NonogramsPreview } from './NonogramsPreview.js'
import { displayTime } from './SudokuMenu.js'

function title(t: Translate, level: GameLevel) {
  return level.source === 'Built-in' || level.source === 'Generated' ? knownMessage(t, level.title) : level.title
}

export const nonogramPresentation: PackPresentation = {
  menuLabel: 'Nonograms menu',
  title: (t, pack) => pack.builtIn ? knownMessage(t, pack.data.title) : pack.data.title,
  description: (t, pack) => pack.builtIn ? knownMessage(t, pack.data.description) : pack.data.description,
  chapterTitle: (t, pack, chapter) => pack.builtIn ? knownMessage(t, chapter.title) : chapter.title,
  chapterDescription: (t, pack, chapter) => pack.builtIn ? knownMessage(t, chapter.description) : chapter.description,
  levelTitle: title,
  detail: (_t, level) => {
    const { rows, columns } = (level as NonogramLevel).content
    return rows.length + ' × ' + columns.length
  },
  details: () => undefined,
  chapterDetails: () => undefined,
  ruleLabels: (t, _pack, chapter) => [t(chapter.rules.inOrder ? 'In order' : 'Pick & choose')],
  challenge: () => '',
}

function QuickPlay({ canPlay, profile, preferences, updatePreferences, launch, perform }: GameMenuContext) {
  const t = useT()
  const key = 'aviarium:nonograms-options:' + profile
  const [options, setOptions] = useState<RandomOptions>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      const parsed = quickDescriptor.pick({ size: true, difficulty: true }).safeParse(saved)
      if (parsed.success) return parsed.data
    } catch { /* Use the starting options if storage is unavailable. */ }
    return { size: 10, difficulty: 'Medium' }
  })
  const [busy, setBusy] = useState(false)
  function update(next: RandomOptions) {
    setOptions(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* The current selection stays usable. */ }
  }
  const timer = Boolean(preferences.nonogramTimer ?? true)
  const summary = options.size + ' × ' + options.size + ' · ' + t('Timer') + ' ' + (timer ? t('On') : t('Off'))
  return <QuickPlayCard primary={{
    key: 'difficulty', label: t('Difficulty'), value: options.difficulty,
    choices: randomDifficulties.map(value => ({ value, label: t(value) })),
    disabled: busy,
    onChange: value => {
      const difficulty = randomDifficulties.find(item => item === value)
      if (difficulty) update({ ...options, difficulty })
    },
  }} options={[
    { key: 'size', label: t('Grid size'), value: options.size,
      choices: randomSizes.map(size => ({ value: size, label: size + ' × ' + size })),
      disabled: busy,
      onChange: (value: string) => update({ ...options, size: gridSizeSchema.parse(Number(value)) }) },
    { key: 'timer', label: t('Show timer'), checked: timer,
      onChange: (checked: boolean) => updatePreferences({ nonogramTimer: checked }) },
  ]} summary={summary} actionLabel={t('Start puzzle')} busyLabel={t('Preparing puzzle…')}
    busy={busy} disabled={!canPlay}
    onSubmit={() => {
      if (!canPlay || busy) return
      setBusy(true)
      perform(async () => {
        try {
          const level = await quickNonogram({ ...options, seed: randomId(), version: 1 })
          if (!level) throw new Error('No random puzzle found. Try again.')
          await launch(level, { playOptions: { timer } })
        } finally { setBusy(false) }
      })
    }}/>
}

export const nonogramsWeb: Omit<WebGame, 'url'> = {
  id: nonogramsId, title: 'Nonograms', description: 'Use row and column clues to reveal a picture.',
  studioDescription: 'Draw Nonograms and publish them in puzzle packs.',
  tags: ['Logic', 'Picross'], eReader: true, input: ['keyboard', 'pointer', 'touch'], theme: 'nonogram-theme',
  connectMessage: 'Connect to install Nonograms on this device.',
  guide: [
    { title: 'The goal', paragraphs: [
      'Each clue tells you the length of a group of filled squares. Read row clues left to right and column clues top to bottom.',
      'For a clue of 2 1, fill two squares together, leave at least one blank, then fill one more. A clue of 0 means the entire line is blank.',
    ] },
    { title: 'Use the controls', paragraphs: [
      'Choose Fill, Mark blank, or Erase, then tap a square. Marks help you keep track of blanks. The puzzle is solved when the filled squares match every clue.',
      'Drag across the grid to mark several squares. Start on a matching mark to clear those marks. Fill and Mark blank preserve each other’s marks. Use Erase to clear either kind. Undo reverses one stroke.',
      'With a keyboard, use the arrow keys to move between squares, Space to use the selected tool, and X to mark a blank.',
    ] },
  ],
  Player: lazy(() => import('./Nonograms.js')),
  Studio: lazy(() => import('./NonogramsStudio.js')),
  packs: nonogramPresentation,
  menu: context => <QuickPlay {...context}/>,
  playOptions: [{ key: 'nonogramTimer', label: 'Show timer', default: true }],
  seed: {
    generate: async (seed, board) => {
      const level = await quickNonogram({ seed, size: gridSizeSchema.parse(Number(board.size)),
        difficulty: randomDifficulties.find(value => value === board.difficulty) ?? 'Medium', version: 1 })
      if (!level) throw new Error('Could not prepare this seed.')
      return level
    },
    summary: (t, board) => [t(randomDifficulties.find(value => value === board.difficulty) ?? 'Medium'),
      String(board.size) + ' × ' + String(board.size)].join(' · '),
  },
  preview: (level, data) => <NonogramsPreview puzzle={(level as NonogramLevel | undefined)?.content}
    marks={(data as NonogramSave | undefined)?.board}/>,
  levelTitle: title,
  resultDetail: (_t, _level, data) => displayTime(data.elapsedMs),
  progress: (t, attempt) => {
    const { board } = attempt as NonogramSave
    return t('{filled} of {total} cells marked', { filled: board.filter(Boolean).length, total: board.length })
  },
  createAttempt: async (level, pack, playOptions) => createNonogramAttempt(level as NonogramLevel, pack, playOptions),
  mutationExtras: input => {
    const level = input as NonogramLevel | undefined
    if (level?.source !== 'Generated') return
    const parsed = quickDescriptor.safeParse({ seed: level.seed, size: level.content.rows.length,
      difficulty: level.difficulty, version: level.generatorVersion })
    return parsed.success ? { quickPlay: parsed.data } : undefined
  },
  favorite: 'favoriteNonograms',
  history: true,
  leaderboards: { boardHref: level => '/games/nonograms/leaderboards/board/' + encodeURIComponent(nonogramBoardKey(level as NonogramLevel).key) },
}
