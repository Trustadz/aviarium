import { lazy, useState } from 'react'
import { twenty48 } from '../../../packages/game-2048/src/metadata.js'
import {
  createTwenty48Attempt, quickPlayVersion, quickTwenty48,
  type Twenty48Level, type Twenty48Save,
} from '../../../packages/game-2048/src/contracts.js'
import { twenty48BoardKey } from '../../../packages/game-2048/src/leaderboards.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { randomId } from './random.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import type { GameMenuContext, WebGame } from './game-web.js'
import { QuickPlayCard } from './QuickPlay.js'
import { Twenty48Preview } from './Twenty48Preview.js'
import twenty48CardArt from './art/game-menu/library-cards/2048-card-art.svg'
import twenty48Mascot from './art/game-menu/mascots/2048-mascot.svg'

function title(t: Translate, level: GameLevel) {
  return level.source === 'Generated' || level.source === 'Challenge'
    ? knownMessage(t, level.title) : level.title
}

function NewGame({ canPlay, launch, perform }: GameMenuContext) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  return <QuickPlayCard actionLabel={t('New game')} busyLabel={t('Preparing board…')}
    busy={busy} disabled={!canPlay} problem={problem || undefined}
    onSubmit={() => {
      if (!canPlay || busy) return
      setBusy(true); setProblem('')
      perform(async () => {
        try {
          await launch(quickTwenty48(randomId(), quickPlayVersion))
        } catch (error) {
          setProblem(error instanceof Error ? error.message : 'Could not start the game.')
        } finally { setBusy(false) }
      })
    }}/>
}

function twenty48Tags(t: Translate, row: LeaderboardStanding) {
  const aids = row.aids as { reached2048?: boolean; moves?: number } | null | undefined
  return [
    ...(aids?.reached2048 ? [{ label: t('Reached 2048'), tone: 'praise' as const }] : []),
    ...(typeof aids?.moves === 'number' ? [{ label: t('{count, plural, one {# move} other {# moves}}', { count: aids.moves }), tone: 'muted' as const }] : []),
  ]
}

export const twenty48Web: Omit<WebGame, 'url'> = {
  ...twenty48,
  description: 'Slide tiles, merge equal numbers, and reach 2048.',
  theme: 'twenty48-theme', mascot: twenty48Mascot, cardArt: twenty48CardArt,
  connectMessage: 'Connect to install 2048 on this device.',
  guide: [
    { title: 'The goal', paragraphs: [
      'Slide every tile in one direction. Equal tiles merge into one tile with twice the value. Create a 2048 tile to reach the goal.',
      'Reaching 2048 does not end the run. Keep going for a higher score. The run ends when the board is full and no neighbouring tiles can merge.',
    ] },
    { title: 'Score and time', paragraphs: [
      'Every merge adds the new tile value to your score. The best score is your highest completed run. The time to your first 2048 tile is recorded for the goal celebration.',
      'The seed controls the starting board and every new tile. The same seed and the same moves give the same run. Copy the seed from the game to share it.',
    ] },
    { title: 'Use the controls', paragraphs: [
      'Use the arrow keys or W A S D, or swipe on the board. A move only counts if a tile moves or merges.',
      'There is no undo. Leave the game and it stays in Continue until the run is finished.',
    ] },
  ],
  Player: lazy(() => import('./Twenty48.js')),
  menu: context => <NewGame {...context}/>,
  playOptions: [],
  seed: {
    generate: async seed => quickTwenty48(seed, quickPlayVersion),
    summary: (t) => t('Classic'),
  },
  sample: () => quickTwenty48('preview', quickPlayVersion),
  preview: (level, data) => <Twenty48Preview level={level as Twenty48Level | undefined}
    attempt={data as Twenty48Save | undefined}/>,
  levelTitle: title,
  resultDetail: (t, _level, data) => t('Score {score}', { score: (data as Twenty48Save).score }),
  progress: (t, data) => {
    const save = data as Twenty48Save
    return t('Score {score} · highest tile {tile}', { score: save.score, tile: Math.max(0, ...save.board) })
  },
  createAttempt: async (level, _pack, playOptions) => createTwenty48Attempt(level as Twenty48Level, playOptions),
  mutationExtras: input => {
    const level = input as Twenty48Level | undefined
    if (level?.source !== 'Generated' || !level.seed) return undefined
    return { quickPlay: { seed: level.seed, version: level.generatorVersion ?? quickPlayVersion } }
  },
  favorite: 'favorite2048',
  history: true,
  leaderboards: {
    boardHref: level => '/games/2048/leaderboards/board/'
      + encodeURIComponent(twenty48BoardKey(level as Twenty48Level).key),
    tags: twenty48Tags,
  },
}
