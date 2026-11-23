import { ArrowLeft, ArrowRight, Download } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { packProgress, type PackCompletion, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt, SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
import { type Translate, useT } from './i18n.js'
import type { Message } from './messages.js'
import { PackTrail, type PackTrailStop } from './PackTrail.js'
import { levelKey, packCompletionEvents } from './storage.js'

export interface PackPresentation {
  menuLabel: Message
  levels(pack: PackRevision): GameLevel[]
  title(t: Translate, pack: PackRevision): string
  description(t: Translate, pack: PackRevision): string
  levelTitle(t: Translate, level: GameLevel): string
  detail(t: Translate, level: GameLevel): string | undefined
  details(t: Translate, pack: PackRevision): string | undefined
  ruleLabels(t: Translate, pack: PackRevision): string[]
  challenge(t: Translate, pack: PackRevision, stop: number): string
  bestTime?(t: Translate, pack: PackRevision, stop: number, completions: GameAttempt[]): string | undefined
}

export const packPath = (pack: Pick<PackRevision, 'id' | 'revision' | 'data'>) =>
  '/games/' + pack.data.game + '/packs/' + pack.id + '/' + pack.revision

export function packApi(game: string) {
  return '/games/' + game + '/packs'
}

export function packExportUrl(pack: Pick<PackRevision, 'id' | 'revision' | 'data'>) {
  return '/api' + packApi(pack.data.game) + '/' + pack.id + '/' + pack.revision + '/export'
}

export function PackCards({ presentation, packs, completed, status, retry, open }: {
  presentation: PackPresentation; packs: PackRevision[]; completed: ReadonlySet<string>; status: 'loading' | 'ready' | 'failed'
  retry: () => void; open: (pack: PackRevision) => void
}) {
  const t = useT()
  return <section className="game-packs" aria-labelledby="packs-title">
    <h2 id="packs-title">{t('Packs')}</h2>
    {packs.length ? <div className="pack-cards">{packs.map(pack => {
      const levels = presentation.levels(pack)
      const solved = levels.filter(level => completed.has(levelKey(level.id, level.revision))).length
      return <button className={`pack-card pack-${pack.data.theme}`} key={pack.id} onClick={() => open(pack)}>
        {pack.data.cover && <img className="pack-cover" src={pack.data.cover} alt=""/>}
        <div className="pack-card-copy">
          <span className="pack-card-title">{presentation.title(t, pack)}<ArrowRight size={18}/></span>
          <span>{[presentation.details(t, pack), t('{solved} of {total} solved', { solved, total: levels.length })].filter(Boolean).join(' · ')}</span>
        </div>
      </button>
    })}</div> : status === 'loading' ? <p role="status">{t('Loading packs…')}</p>
      : status === 'failed' ? <p role="status">{t('Could not load packs.')}</p>
        : <p>{t('No packs available on this device yet.')}</p>}
    {status === 'failed' && <button className="text-button" onClick={retry}>{t('Retry loading packs')}</button>}
  </section>
}

export function PackRoadmap({ presentation, pack, completed, sessions, canPlay, canExport, leave, play, preview = false,
  previewDetails, previewCompletions }: {
  presentation: PackPresentation; pack: PackRevision; completed: ReadonlySet<string>; sessions: readonly SavedAttempt[]
  canPlay: boolean; canExport: boolean; leave: () => void; play: (level: GameLevel) => void; preview?: boolean
  previewDetails?: ReadonlyMap<string, string | undefined>; previewCompletions?: readonly PackCompletion[]
}) {
  const t = useT()
  const levels = presentation.levels(pack)
  const { solved, playable, next } = packProgress(pack, previewCompletions ?? packCompletionEvents(completed, sessions))
  const art = pack.data.cover ?? pack.data.background
  const description = presentation.description(t, pack)
  const stops: PackTrailStop[] = levels.map((level, index) => {
    const locked = !playable[index]
    const entry = pack.data.puzzles[index]
    const matching = sessions.filter(item => item.data.game === pack.data.game &&
      item.data.level === level.id && item.data.levelRevision === level.revision)
    const saved = matching.some(item => !item.archived && !item.data.completed && item.data.lives !== 0)
    const action = t(saved ? 'Resume' : solved[index] ? 'Replay' : 'Play')
    const title = presentation.levelTitle(t, level)
    const detail = previewDetails ? previewDetails.get(level.id) ?? t('Ungraded') : presentation.detail(t, level)
    return { id: level.id, title, state: locked ? 'locked' : solved[index] ? 'solved' : next === index ? 'next' : 'available',
      play: () => play(level), detail, actionLabel: action, actionName: t('{action} {title}', { action, title }),
      chapter: entry.chapter, introduction: entry.introduction, challenge: presentation.challenge(t, pack, index + 1),
      statusLabel: locked ? t('Solve the previous stop to unlock') : solved[index] ? t('Solved') : next === index ? t('Up next') : undefined,
      bestTime: presentation.bestTime?.(t, pack, index + 1, matching.filter(item => item.data.completed).map(item => item.data)) }
  })
  return <section className={`catalog pack-roadmap pack-${pack.data.theme}`}>
    <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t(preview ? 'Back to editor' : presentation.menuLabel)}</button>
      {canExport && <a className="text-button" href={packExportUrl(pack)} download><Download size={17}/> {t('Export pack')}</a>}
    </div>
    <header className="pack-banner">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro"><h1>{presentation.title(t, pack)}</h1>
        {description && <p>{description}</p>}
        <p>{levels.length
          ? [previewDetails && [...previewDetails.values()].some(detail => !detail) ? t('Ungraded') : presentation.details(t, pack),
            t('{solved} of {total} solved', { solved: solved.filter(Boolean).length, total: levels.length })].filter(Boolean).join(' · ')
          : t('Add a level to preview the trail.')}</p>
        <ul className="pack-tags">{presentation.ruleLabels(t, pack).map(rule => <li className="badge" key={rule}>{rule}</li>)}</ul>
      </div>
    </header>
    {stops.length > 0 && <PackTrail key={packPath(pack)} stops={stops} canPlay={canPlay} scrollToStop={!preview}/>}
  </section>
}
