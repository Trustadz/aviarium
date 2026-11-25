import { ArrowLeft, ArrowRight, Check, Download, LockKeyhole } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { chapterProgress, packCover, packLevelCount, packProgress, packTheme,
  type PackChapter, type PackCompletion, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt, SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
import { type Translate, useT } from './i18n.js'
import { packLevels } from './game-definitions.js'
import type { Message } from './messages.js'
import { PackTrail, type PackTrailStop } from './PackTrail.js'
import { levelKey, packCompletionEvents } from './storage.js'

export interface PackPresentation {
  menuLabel: Message
  title(t: Translate, pack: PackRevision): string
  description(t: Translate, pack: PackRevision): string
  chapterTitle(t: Translate, pack: PackRevision, chapter: PackChapter): string
  chapterDescription(t: Translate, pack: PackRevision, chapter: PackChapter): string
  levelTitle(t: Translate, level: GameLevel): string
  detail(t: Translate, level: GameLevel): string | undefined
  details(t: Translate, pack: PackRevision): string | undefined
  chapterDetails?(t: Translate, pack: PackRevision, chapter: PackChapter): string | undefined
  ruleLabels(t: Translate, pack: PackRevision, chapter: PackChapter): string[]
  challenge(t: Translate, pack: PackRevision, chapter: PackChapter, stop: number): string
  bestTime?(t: Translate, pack: PackRevision, chapter: PackChapter, stop: number, completions: GameAttempt[]): string | undefined
}

export const packPath = (pack: Pick<PackRevision, 'id' | 'revision' | 'data'>) =>
  '/games/' + pack.data.game + '/packs/' + pack.id + '/' + pack.revision

export const chapterPath = (pack: Pick<PackRevision, 'id' | 'revision' | 'data'>, chapterId: string) =>
  packPath(pack) + '/chapters/' + chapterId

export function packApi(game: string) {
  return '/games/' + game + '/packs'
}

export function packExportUrl(pack: Pick<PackRevision, 'id' | 'revision' | 'data'>) {
  return '/api' + packApi(pack.data.game) + '/' + pack.id + '/' + pack.revision + '/export'
}

export function PackCards({ game, presentation, packs, completed, status, retry, open }: {
  game: string; presentation: PackPresentation; packs: PackRevision[]; completed: ReadonlySet<string>; status: 'loading' | 'ready' | 'failed'
  retry: () => void; open: (pack: PackRevision) => void
}) {
  const t = useT()
  return <section className="game-packs" aria-labelledby="packs-title">
    <h2 id="packs-title">{t('Packs')}</h2>
    {packs.length ? <div className="pack-cards">{packs.map(pack => {
      const levels = packLevels(game, pack)
      const solved = levels.filter(level => completed.has(levelKey(level.id, level.revision))).length
      const cover = packCover(pack)
      return <button className={`pack-card pack-${packTheme(pack)}`} key={pack.id} onClick={() => open(pack)}>
        {cover && <img className="pack-cover" src={cover} alt=""/>}
        <div className="pack-card-copy">
          <span className="pack-card-title">{presentation.title(t, pack)}<ArrowRight size={18}/></span>
          <span>{[presentation.details(t, pack),
            t('{count, plural, one {# chapter} other {# chapters}}', { count: pack.data.chapters.length }),
            t('{solved} of {total} solved', { solved, total: levels.length })].filter(Boolean).join(' · ')}</span>
        </div>
      </button>
    })}</div> : status === 'loading' ? <p role="status">{t('Loading packs…')}</p>
      : status === 'failed' ? <p role="status">{t('Could not load packs.')}</p>
        : <p>{t('No packs available on this device yet.')}</p>}
    {status === 'failed' && <button className="text-button" onClick={retry}>{t('Retry loading packs')}</button>}
  </section>
}

export function PackChapters({ presentation, pack, completed, sessions, canExport, leave, open, preview = false,
  previewCompletions, tools, header }: {
  presentation: PackPresentation; pack: PackRevision; completed: ReadonlySet<string>; sessions: readonly SavedAttempt[]
  canExport: boolean; leave: () => void; open?: (chapterId: string) => void; preview?: boolean
  previewCompletions?: readonly PackCompletion[]; tools?: ReactNode; header?: ReactNode
}) {
  const t = useT()
  const completions = previewCompletions ?? packCompletionEvents(completed, sessions)
  const total = packLevelCount(pack)
  const solved = packProgress(pack, completions).solved.filter(Boolean).length
  const art = packCover(pack)
  const description = presentation.description(t, pack)
  return <section className={`catalog pack-roadmap pack-chapters pack-${packTheme(pack)}`}>
    {header ?? <div className="game-navigation">
      {!preview && <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t('Back')}</button>}
      <div className="game-nav-tools">
        {tools}
        {canExport && <a className="icon-button" href={packExportUrl(pack)} download
          aria-label={t('Export pack')} title={t('Export pack')}><Download size={18}/></a>}
      </div>
    </div>}
    <header className="pack-banner pack-screen-summary">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro">{!header && <h1>{presentation.title(t, pack)}</h1>}
        {description && <p>{description}</p>}
        <p>{[presentation.details(t, pack),
          t('{count, plural, one {# chapter} other {# chapters}}', { count: pack.data.chapters.length }),
          t('{solved} of {total} solved', { solved, total })].filter(Boolean).join(' · ')}</p>
      </div>
    </header>
    <div className="chapter-cards">{pack.data.chapters.map((chapter, index) => {
      const progress = chapterProgress(pack, completions, chapter.id)
      const chapterArt = chapter.cover ?? chapter.background
      const locked = !progress.unlocked
      return <button className={`chapter-card pack-${chapter.theme}` + (locked ? ' is-locked' : '') +
        (chapterArt ? '' : ' no-art')} key={chapter.id}
        onClick={open && !locked ? () => open(chapter.id) : undefined} disabled={!open || locked}
        aria-label={!open ? undefined : locked
          ? t('Chapter {title} is locked', { title: presentation.chapterTitle(t, pack, chapter) })
          : t('Open chapter {title}', { title: presentation.chapterTitle(t, pack, chapter) })}>
        <span className="chapter-card-art">
          {chapterArt ? <img className="chapter-cover" src={chapterArt} alt=""/> : <span className="chapter-cover chapter-cover-empty"/>}
          <span className="chapter-number">{index + 1}</span>
        </span>
        <span className="chapter-card-body">
          <span className="eyebrow">{t('Chapter {number}', { number: index + 1 })}</span>
          <span className="chapter-card-title">{presentation.chapterTitle(t, pack, chapter)}
            {locked ? <LockKeyhole size={18} aria-label={t('Locked')}/> : progress.complete
              ? <Check size={18} aria-label={t('Completed')}/> : <ArrowRight size={18} aria-hidden="true"/>}</span>
          {presentation.chapterDescription(t, pack, chapter) &&
            <span className="chapter-card-description">{presentation.chapterDescription(t, pack, chapter)}</span>}
          <span className="chapter-card-progress">
            <span className="chapter-progress-track" aria-hidden="true"><span style={{ width: progress.total ? progress.completed / progress.total * 100 + '%' : '0%' }}/></span>
            <span>{t('{solved} of {total} solved', { solved: progress.completed, total: progress.total })}</span>
          </span>
          {locked && <span className="chapter-card-locked"><LockKeyhole size={14} aria-hidden="true"/> {t('Complete the previous chapter to unlock')}</span>}
        </span>
      </button>
    })}</div>
    {!pack.data.chapters.length && <p className="empty">{t('Add a chapter to open its trail.')}</p>}
  </section>
}

export function PackRoadmap({ game, presentation, pack, chapterId, completed, sessions, canPlay, canExport, leave, play, preview = false,
  previewDetails, previewCompletions, tools, header }: {
  game: string; presentation: PackPresentation; pack: PackRevision; chapterId: string; completed: ReadonlySet<string>
  sessions: readonly SavedAttempt[]; canPlay: boolean; canExport: boolean; leave: () => void; play: (level: GameLevel) => void
  preview?: boolean; previewDetails?: ReadonlyMap<string, string | undefined>; previewCompletions?: readonly PackCompletion[]
  tools?: ReactNode; header?: ReactNode
}) {
  const t = useT()
  const chapter = pack.data.chapters.find(item => item.id === chapterId) ?? pack.data.chapters[0]
  const levels = chapter ? packLevels(game, pack).filter(level => level.pack?.chapter === chapter.id) : []
  const completions = previewCompletions ?? packCompletionEvents(completed, sessions)
  const chapterState = chapter ? chapterProgress(pack, completions, chapter.id) : undefined
  const locked = !preview && chapterState ? !chapterState.unlocked : false
  const { solved, playable, next } = packProgress(pack, completions, chapter?.id)
  const art = chapter?.cover ?? chapter?.background
  const description = chapter ? presentation.chapterDescription(t, pack, chapter) : ''
  const stops: PackTrailStop[] = levels.map((level, index) => {
    const entry = chapter?.puzzles[index]
    const locked = !playable[index]
    const matching = sessions.filter(item => item.data.game === pack.data.game &&
      item.data.level === level.id && item.data.levelRevision === level.revision)
    const saved = matching.some(item => !item.archived && !item.data.completed && item.data.lives !== 0)
    const action = t(saved ? 'Resume' : solved[index] ? 'Replay' : 'Play')
    const title = presentation.levelTitle(t, level)
    const detail = previewDetails ? previewDetails.get(level.id) ?? t('Ungraded') : presentation.detail(t, level)
    return { id: level.id, title, state: locked ? 'locked' : solved[index] ? 'solved' : next === index ? 'next' : 'available',
      play: () => play(level), detail, actionLabel: action, actionName: t('{action} {title}', { action, title }),
      introduction: entry?.introduction, challenge: chapter ? presentation.challenge(t, pack, chapter, index + 1) : '',
      statusLabel: locked ? t('Solve the previous stop to unlock') : solved[index] ? t('Solved') : next === index ? t('Up next') : undefined,
      bestTime: chapter && presentation.bestTime?.(t, pack, chapter, index + 1,
        matching.filter(item => item.data.completed).map(item => item.data)) }
  })
  return <section className={`catalog pack-roadmap pack-trail-screen pack-${chapter?.theme ?? packTheme(pack)}`}>
    {header ?? <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t(preview ? 'Back to editor' : 'Back')}</button>
      <div className="game-nav-tools">
        {tools}
        {canExport && <a className="icon-button" href={packExportUrl(pack)} download
          aria-label={t('Export pack')} title={t('Export pack')}><Download size={18}/></a>}
      </div>
    </div>}
    {chapter && <header className="pack-banner pack-screen-summary">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro">{!header && <h1>{presentation.chapterTitle(t, pack, chapter)}</h1>}
        {description && <p>{description}</p>}
        <p>{levels.length
          ? [previewDetails && [...previewDetails.values()].some(detail => !detail) ? t('Ungraded') : presentation.chapterDetails?.(t, pack, chapter),
            t('{solved} of {total} solved', { solved: solved.filter(Boolean).length, total: levels.length })].filter(Boolean).join(' · ')
          : t('Add a level to preview the trail.')}</p>
        <ul className="pack-tags">{presentation.ruleLabels(t, pack, chapter).map(rule => <li className="badge" key={rule}>{rule}</li>)}</ul>
      </div>
    </header>}
    {locked ? <p className="chapter-locked-notice" role="status">
      <LockKeyhole size={20} aria-hidden="true"/> {t('Complete the previous chapter to unlock this chapter.')}
    </p> : stops.length > 0 && <PackTrail key={chapterPath(pack, chapter?.id ?? chapterId)} stops={stops} canPlay={canPlay} scrollToStop={!preview}/>}
  </section>
}
