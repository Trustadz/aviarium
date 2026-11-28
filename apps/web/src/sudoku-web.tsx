import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { lazy } from 'react'
import { defaults, quickPlayVersion, type SudokuSave } from '../../../packages/sudoku/src/contracts.js'
import { difficulties, type Difficulty } from '../../../packages/game-sdk/src/index.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { effectivePackRules, packLevels, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { sudokuBoardKey } from '../../../packages/sudoku/src/leaderboards.js'
import sudokuCardArt from './art/game-menu/library-cards/sudoku-card-art.svg'
import sudokuMascot from './art/game-menu/mascots/sudoku-mascot.svg'
import type { GuideSection } from './GameGuide.js'
import type { GamePlayerProps, WebGame } from './game-web.js'
import { SudokuPreview } from './Grid.js'
import { levelTitle, sudokuResultTags } from './sudoku-copy.js'
import { displayTime, QuickPlay, sudokuPackPresentation } from './SudokuMenu.js'
import { createQuickPlayLevel } from './quick-play.js'
import type { GameMenuContext } from './game-web.js'
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
      'Hint opens a panel that suggests a solving technique. Ask it to highlight the relevant squares, then reveal what to enter or which candidate to remove. Hints cool down for 10 seconds between uses. Some packs limit which aids you can use.',
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
      persist={data => {
        const pack = props.pack as PublishedPack | undefined
        const rules = pack && props.level.pack ? effectivePackRules(pack, props.level.pack.stop) : undefined
        const save: SudokuSave = { ...data, aids: {
          hints: Boolean(preferences.hints && rules?.hints !== false),
          autoNotes: Boolean(preferences.autoNotes), mistakes: Boolean(preferences.mistakes),
        } }
        return props.persist(save)
      }}/>
  } }
})

function SudokuMenuOptions(context: GameMenuContext) {
  return <QuickPlay {...context}/>
}

export const sudokuWeb: Omit<WebGame, 'url'> = {
  ...sudoku, studioDescription: 'Design Sudoku puzzles, arrange them in packs, and test how they play.',
  theme: 'sudoku-theme', mascot: sudokuMascot, cardArt: sudokuCardArt, guide: sudokuGuide,
  Studio: lazy(() => import('./SudokuStudio.js')), Player: SudokuPlayer, packs: sudokuPackPresentation,
  menu: context => <SudokuMenuOptions {...context}/>,
  playOptions: [
    { key: 'hints', label: 'Hints', default: true },
    { key: 'autoNotes', label: 'Auto notes', default: true },
    { key: 'autoNoteDeletion', label: 'Remove conflicting notes', default: true },
    { key: 'mistakes', label: 'Highlight conflicts', default: true },
    { key: 'timer', label: 'Show timer', default: true },
  ],
  seed: {
    generate: (seed, board) => createQuickPlayLevel(board.difficulty as Difficulty, seed, quickPlayVersion),
    summary: (t, board) => t(board.difficulty as Difficulty),
  },
  sample: packs => {
    const pack = packs.find(pack => pack.builtIn && pack.data.game === sudoku.id)
    return pack ? packLevels(pack as PublishedPack)[0] : undefined
  },
  preview: (level, data) => level || data ? <SudokuPreview grid={(level as PublishedLevel | undefined)?.grid}
    entries={(data as SudokuSave | undefined)?.board.entries}/> : null,
  levelTitle: (t, level) => levelTitle(t, level as PublishedLevel),
  resultDetail: (_t, _level, data) => displayTime(data.elapsedMs),
  progress: (t, data) => {
    const entries = (data as SudokuSave).board.entries
    return t('{filled} of {total} cells filled', { filled: entries.filter(Boolean).length, total: entries.length })
  },
  async createAttempt(level, pack, playOptions) {
    const { createSave } = await import('./Player.js')
    return createSave(level as PublishedLevel, pack as PublishedPack | undefined, playOptions)
  },
  mutationExtras: input => {
    const level = input as PublishedLevel | undefined
    return level?.id.startsWith('quick-') && level.seed && level.generatorVersion === quickPlayVersion
      ? { quickPlay: { seed: level.seed, difficulty: level.difficulty, version: quickPlayVersion } } : undefined
  },
  favorite: 'favorite',
  connectMessage: 'Connect to install Sudoku on this device.',
  history: true,
  leaderboards: {
    boardHref: level => '/games/sudoku/leaderboards/board/' + encodeURIComponent(sudokuBoardKey(level).key),
    tags: (t, row) => sudokuResultTags(t, row.aids),
  },
}
