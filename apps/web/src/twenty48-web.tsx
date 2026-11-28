import { lazy, useState } from 'react'
import { Shuffle } from 'lucide-react'
import { twenty48 } from '../../../packages/game-2048/src/metadata.js'
import {
  createTwenty48Attempt, parseTwenty48SeedCode, quickPlayVersion, quickTwenty48,
  type Twenty48Level, type Twenty48Save,
} from '../../../packages/game-2048/src/contracts.js'
import { twenty48BoardKey } from '../../../packages/game-2048/src/leaderboards.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { LeaderboardStanding } from '../../../packages/game-sdk/src/leaderboards.js'
import { randomId } from './random.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import { errorMessage } from './api.js'
import type { GameMenuContext, WebGame } from './game-web.js'
import { Twenty48Preview } from './Twenty48Preview.js'

function title(t: Translate, level: GameLevel) {
  return level.source === 'Generated' || level.source === 'Challenge'
    ? knownMessage(t, level.title) : level.title
}

function NewGame({ canPlay, launch, perform }: GameMenuContext) {
  const t = useT()
  const params = new URLSearchParams(location.search)
  const [seed, setSeed] = useState(() => params.get('seed')?.slice(0, 80) ?? '')
  const [showSeed, setShowSeed] = useState(() => Boolean(params.get('seed')))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const parsed = seed.trim() ? parseTwenty48SeedCode(seed) : undefined
  const invalid = showSeed && Boolean(seed.trim()) && !parsed
  return <section className="quick-play panel" aria-labelledby="twenty48-new-title">
    <form onSubmit={event => {
      event.preventDefault()
      if (!canPlay || busy || invalid) return
      setBusy(true)
      setProblem('')
      perform(async () => {
        try {
          const next = showSeed && parsed ? parsed : { seed: randomId(), version: quickPlayVersion }
          await launch(quickTwenty48(next.seed, next.version))
        } catch (error) {
          setProblem(errorMessage(error))
        } finally {
          setBusy(false)
        }
      })
    }}>
      <div className="quick-play-header">
        <h2 id="twenty48-new-title">{t('Quick Play')}</h2>
        <button type="button" className="text-button" aria-expanded={showSeed} disabled={busy}
          onClick={() => setShowSeed(value => !value)}>{showSeed ? t('Random seed') : t('Enter seed')}</button>
      </div>
      {showSeed && <label className="quick-seed">{t('Seed (optional)')}
        <input value={seed} maxLength={80} placeholder={t('Leave blank for a random board')}
          onChange={event => setSeed(event.target.value)} aria-invalid={invalid || undefined}/>
      </label>}
      {invalid && <p className="error" role="alert">{t('Use letters, numbers, dots, dashes or underscores.')}</p>}
      <div className="quick-play-actions">
        <button className="primary" type="submit" disabled={!canPlay || busy || invalid}>
          <Shuffle size={17}/> {t(busy ? 'Preparing board…' : showSeed && seed.trim() ? 'Play seed' : 'New game')}
        </button>
      </div>
      {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    </form>
  </section>
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
  theme: 'twenty48-theme',
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
