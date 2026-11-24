import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { lazy } from 'react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { defaults, quickPlayVersion, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import type { PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { api } from './api.js'
import type { GuideSection } from './GameGuide.js'
import type { GamePlayerProps, WebGame } from './game-web.js'
import { SudokuPreview } from './Grid.js'
import { levelTitle } from './sudoku-copy.js'
import { displayTime, PuzzleShare, QuickPlay, sudokuPackPresentation } from './SudokuMenu.js'
import { useT } from './i18n.js'
import type { LocalSession } from './storage.js'

const sudokuGuide: readonly GuideSection[] = [
  {
    title: 'The goal',
    paragraphs: [
      'Fill every empty square so each row, column, and 3 × 3 box contains the digits 1 through 9 exactly once. The puzzle gives you some numbers to start with. Those squares are fixed.',
    ],
  },
  {
    title: 'Find your first number',
    paragraphs: [
      'Start with a row, column, or box that’s nearly full. If a row has one empty square and the only missing digit is 7, then 7 goes in that square.',
      'When there are several empty squares, check each square’s row, column, and box to rule out digits already present. Keep looking for squares with only one possible digit.',
    ],
  },
  {
    title: 'Use the controls',
    paragraphs: [
      'Select an empty square, then tap a number to enter it. Press and hold a number to keep it selected while you fill multiple squares.',
      'Turn on Notes to pencil in possible digits. Auto notes fills candidates based on the numbers already on the board. You can enable automatic note deletion in Sudoku settings.',
      'Hint first suggests a solving technique, then highlights the relevant squares on the second press. Press it a third time to reveal what to enter or which candidate to remove. Some packs limit which aids you can use.',
    ],
  },
]

const SudokuPlayer = lazy(async () => {
  const { default: Player } = await import('./Player.js')
  return { default: function GamePlayer(props: GamePlayerProps) {
    const preferences = { ...defaults, ...props.preferences }
    return <Player {...props} session={props.session as LocalSession<SudokuSave>} level={props.level as PublishedLevel}
      pack={props.pack as PublishedPack | undefined} preferences={preferences}
      leaderboard={props.leaderboard}
      persist={data => props.persist({ ...data, aids: {
        hints: Boolean(preferences.hints), autoNotes: Boolean(preferences.autoNotes),
        mistakes: Boolean(preferences.mistakes),
      } })}/>
  } }
})

function SudokuMenuOptions({ canPlay, online, profile, params, launch, perform }: Parameters<NonNullable<WebGame['menu']>>[0]) {
  const t = useT()
  const sharedId = params.get('puzzle')
  const sharedRevision = params.get('revision')
  return <>
    {sharedId && sharedRevision && <button className="secondary" disabled={!online} onClick={() => perform(async () => {
      const level = await api<PublishedLevel>(`/games/sudoku/levels/${encodeURIComponent(sharedId)}/${encodeURIComponent(sharedRevision)}`,
        undefined, profile)
      await launch(level)
    })}>{t('Play shared puzzle')}</button>}
    <QuickPlay canPlay={canPlay} profile={profile} generate={async (difficulty, seed, version) => {
      const { createQuickPlayLevel } = await import('./Player.js')
      await launch(await createQuickPlayLevel(difficulty, seed, version))
    }}/>
  </>
}

export const sudokuWeb: Omit<WebGame, 'url'> = {
  ...sudoku, studioDescription: 'Design Sudoku puzzles, arrange them in packs, and test how they play.',
  theme: 'sudoku-theme', guide: sudokuGuide, catalog: '/catalog',
  Studio: lazy(() => import('./SudokuStudio.js')), Player: SudokuPlayer, packs: sudokuPackPresentation,
  menu: context => <SudokuMenuOptions {...context}/>,
  sample: levels => levels.find(level => level.id === 'first-light') ?? levels.find(level => !level.game || level.game === sudoku.id),
  preview: (level, data) => level || data ? <SudokuPreview grid={(level as PublishedLevel | undefined)?.grid}
    entries={(data as SudokuSave | undefined)?.board.entries}/> : null,
  levelTitle: (t, level) => levelTitle(t, level as PublishedLevel),
  resultDetail: (_t, _level, data) => displayTime(data.elapsedMs),
  progress: (t, data) => {
    const entries = (data as SudokuSave).board.entries
    return t('{filled} of {total} cells filled', { filled: entries.filter(Boolean).length, total: entries.length })
  },
  share: level => <PuzzleShare level={level as PublishedLevel}/>,
  mutationExtras: input => {
    const level = input as PublishedLevel | undefined
    return level?.id.startsWith('quick-') && level.seed && level.generatorVersion === quickPlayVersion
      ? { quickPlay: { seed: level.seed, difficulty: level.difficulty, version: quickPlayVersion } } : undefined
  },
  favorite: 'favorite',
  settings: { title: 'Sudoku settings', toggles: [
    { key: 'mistakes', label: 'Highlight conflicts', default: defaults.mistakes },
    { key: 'timer', label: 'Show timer', default: defaults.timer },
    { key: 'hints', label: 'Enable hints', default: defaults.hints },
    { key: 'autoNotes', label: 'Show Auto notes button', default: defaults.autoNotes },
    { key: 'autoNoteDeletion', label: 'Automatically remove conflicting notes', default: defaults.autoNoteDeletion },
  ] },
  connectMessage: 'Connect to install Sudoku on this device.',
  history: true,
}
