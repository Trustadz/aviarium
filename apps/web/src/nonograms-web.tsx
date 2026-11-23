import { lazy, useState } from 'react'
import { Shuffle } from 'lucide-react'
import {
  createNonogramAttempt, gridSizeSchema, nonogramLevels, nonogramsId, quickNonogram, quickDescriptor,
  type NonogramLevel, type NonogramPack, type NonogramSave,
} from '../../../packages/nonograms/src/contracts.js'
import { randomDifficulties, randomSizes, type RandomOptions } from '../../../packages/nonograms/src/puzzles.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import type { GameMenuContext, WebGame } from './game-web.js'
import type { PackPresentation } from './GamePacks.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { NonogramsPreview } from './NonogramsPreview.js'
import { displayTime } from './SudokuMenu.js'

function title(t: Translate, level: GameLevel) {
  return level.source === 'Built-in' || level.source === 'Generated' ? knownMessage(t, level.title) : level.title
}

export const nonogramPresentation: PackPresentation = {
  menuLabel: 'Nonograms menu',
  levels: pack => nonogramLevels(pack as NonogramPack),
  title: (t, pack) => pack.builtIn ? knownMessage(t, pack.data.title) : pack.data.title,
  description: (t, pack) => pack.builtIn ? knownMessage(t, pack.data.description) : pack.data.description,
  levelTitle: title,
  detail: (_t, level) => {
    const { rows, columns } = (level as NonogramLevel).content
    return rows.length + ' × ' + columns.length
  },
  details: () => undefined,
  ruleLabels: (t, pack) => [t(pack.data.rules.inOrder ? 'In order' : 'Pick & choose')],
  challenge: () => '',
}

function QuickPlay({ canPlay, profile, launch, perform }: GameMenuContext) {
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

  return <section className="quick-play panel" aria-labelledby="nonogram-random-title">
    <form onSubmit={event => {
      event.preventDefault()
      if (!canPlay || busy) return
      setBusy(true)
      perform(async () => {
        try {
          const level = await quickNonogram({ ...options, seed: crypto.randomUUID(), version: 1 })
          if (!level) throw new Error('No random puzzle found. Try again.')
          await launch(level)
        } finally { setBusy(false) }
      })
    }}>
      <div className="quick-play-header"><h2 id="nonogram-random-title">{t('Quick Play')}</h2></div>
      <div className="quick-play-actions nonogram-options">
        <select aria-label={t('Grid size')} value={options.size} disabled={busy} onChange={event => {
          update({ ...options, size: gridSizeSchema.parse(Number(event.target.value)) })
        }}>
          {randomSizes.map(size => <option key={size} value={size}>{size} × {size}</option>)}
        </select>
        <select aria-label={t('Difficulty')} value={options.difficulty} disabled={busy} onChange={event => {
          const difficulty = randomDifficulties.find(value => value === event.target.value)
          if (difficulty) update({ ...options, difficulty })
        }}>
          {randomDifficulties.map(difficulty => <option key={difficulty} value={difficulty}>{t(difficulty)}</option>)}
        </select>
        <button className="primary" type="submit" disabled={!canPlay || busy}>
          <Shuffle size={17}/> {t(busy ? 'Preparing puzzle…' : 'New puzzle')}
        </button>
      </div>
    </form>
  </section>
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
  preview: (level, data) => <NonogramsPreview puzzle={(level as NonogramLevel | undefined)?.content}
    marks={(data as NonogramSave | undefined)?.board}/>,
  levelTitle: title,
  resultDetail: (_t, _level, data) => displayTime(data.elapsedMs),
  progress: (t, attempt) => {
    const { board } = attempt as NonogramSave
    return t('{filled} of {total} cells marked', { filled: board.filter(Boolean).length, total: board.length })
  },
  createAttempt: async (level, pack) => createNonogramAttempt(level as NonogramLevel, pack),
  mutationExtras: input => {
    const level = input as NonogramLevel | undefined
    if (level?.source !== 'Generated') return
    const parsed = quickDescriptor.safeParse({ seed: level.seed, size: level.content.rows.length,
      difficulty: level.difficulty, version: level.generatorVersion })
    return parsed.success ? { quickPlay: parsed.data } : undefined
  },
  favorite: 'favoriteNonograms',
  history: true,
}
