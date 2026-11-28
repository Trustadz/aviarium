import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, LockKeyhole } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { chapterProgress, packCover, packLevelCount, packProgress, packTheme,
  type PackChapter, type PackCompletion, type PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { GameAttempt, SavedAttempt } from '../../../packages/game-sdk/src/progress.js'
import { type Translate, useT } from './i18n.js'
import { packLevels } from './game-definitions.js'
import type { Message } from './messages.js'
import { PackTrail, type PackTrailStop } from './PackTrail.js'
import { packCompletionEvents } from './storage.js'
import './packs.css'

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

function solvedText(t: Translate, solved: number, total: number) {
  return t('{solved} of {total} solved', { solved, total })
}

/**
 * The Packs destination. Each pack is one illustrated row that carries its
 * cover, its grade range, and the player's progress into the catalog.
 */
export function PackCatalog({ gameTitle, presentation, packs, completed, sessions, status, retry, leave, open }: {
  gameTitle: string; presentation: PackPresentation; packs: PackRevision[]; completed: ReadonlySet<string>
  sessions: readonly SavedAttempt[]; status: 'loading' | 'ready' | 'failed'
  retry: () => void; leave: () => void; open: (pack: PackRevision) => void
}) {
  const t = useT()
  const completions = packCompletionEvents(completed, sessions)
  return <section className="catalog pack-catalog pack-destination" aria-labelledby="pack-catalog-title">
    <button className="text-button pack-catalog-back" onClick={leave}>
      <ArrowLeft size={17} aria-hidden="true"/><span className="sr-only">{t('Back')} </span>{gameTitle}
    </button>
    <h1 id="pack-catalog-title">{t('Packs')}</h1>
    {packs.length ? <ul className="pack-catalog-list">
      {packs.map(pack => {
        const total = packLevelCount(pack)
        const solved = packProgress(pack, completions).solved.filter(Boolean).length
        const cover = packCover(pack)
        const details = [presentation.details(t, pack),
          t('{count, plural, one {# chapter} other {# chapters}}', { count: pack.data.chapters.length })]
          .filter(Boolean).join(' · ')
        return <li className={`pack-catalog-item pack-${packTheme(pack)}`} key={pack.id}>
          <a className="pack-catalog-card" href={packPath(pack)} aria-label={t('Open {pack} pack', { pack: presentation.title(t, pack) })} onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault(); open(pack)
          }}>
            <span className="pack-catalog-art" aria-hidden="true">{cover
              ? <img src={cover} alt=""/>
              : <span className="pack-catalog-art-empty"/>}</span>
            <span className="pack-catalog-body">
              <span className="pack-catalog-title">{presentation.title(t, pack)}</span>
              {details && <span className="pack-catalog-details">{details}</span>}
              <span className="pack-catalog-progress">
                <span>{solvedText(t, solved, total)}</span>
                <span className="pack-progress-track" aria-hidden="true">
                  <span style={{ width: total ? solved / total * 100 + '%' : '0%' }}/>
                </span>
              </span>
              <span className="pack-catalog-action">{t('Open pack')}
                <ChevronRight size={18} aria-hidden="true"/></span>
            </span>
          </a>
        </li>
      })}
    </ul> : status === 'loading' ? <p role="status">{t('Loading packs…')}</p>
      : status === 'failed' ? <p role="status">{t('Could not load packs.')}</p>
        : <p className="empty">{t('No packs available on this device yet.')}</p>}
    {status === 'failed' && <button className="text-button" onClick={retry}>{t('Retry loading packs')}</button>}
  </section>
}

/**
 * A pack's illustrated chapter overview. Chapters stay locked in order, so a
 * locked card never presents a follow action and explains the requirement.
 */
export function PackChapters({ presentation, pack, completed, sessions, canExport, leave, open, preview = false,
  previewCompletions, tools, header, navigation }: {
  presentation: PackPresentation; pack: PackRevision; completed: ReadonlySet<string>; sessions: readonly SavedAttempt[]
  canExport: boolean; leave: () => void; open?: (chapterId: string) => void; preview?: boolean
  previewCompletions?: readonly PackCompletion[]; tools?: ReactNode; header?: ReactNode; navigation?: ReactNode
}) {
  const t = useT()
  const completions = previewCompletions ?? packCompletionEvents(completed, sessions)
  const total = packLevelCount(pack)
  const solved = packProgress(pack, completions).solved.filter(Boolean).length
  const art = packCover(pack)
  const description = presentation.description(t, pack)
  const progressText = solvedText(t, solved, total)
  return <section className={`catalog pack-roadmap pack-chapters pack-destination pack-${packTheme(pack)}`}>
    {navigation ? <div className="pack-screen-navigation">{navigation}</div> : <div className="game-navigation">
      {!preview && <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t('Back')}</button>}
      <div className="game-nav-tools">
        {tools}
        {canExport && <a className="icon-button" href={packExportUrl(pack)} download
          aria-label={t('Export pack')} title={t('Export pack')}><Download size={18}/></a>}
      </div>
    </div>}
    {header}
    {preview ? <header className="pack-banner pack-screen-summary">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro">{!header && <h1>{presentation.title(t, pack)}</h1>}
        {description && <p>{description}</p>}
        <p>{[presentation.details(t, pack),
          t('{count, plural, one {# chapter} other {# chapters}}', { count: pack.data.chapters.length }),
          progressText].filter(Boolean).join(' · ')}</p>
      </div>
    </header> : <div className="pack-overview-summary">
      {description && <p className="pack-overview-description">{description}</p>}
      <p className="pack-overview-progress">
        <span className="pack-progress-track" aria-hidden="true">
          <span style={{ width: total ? solved / total * 100 + '%' : '0%' }}/>
        </span>
        <span className="pack-overview-solved">{progressText}</span>
      </p>
    </div>}
    <div className="pack-chapter-list">{pack.data.chapters.map((chapter, index) => {
      const progress = chapterProgress(pack, completions, chapter.id)
      const chapterArt = chapter.cover ?? chapter.background
      const locked = !progress.unlocked
      const ruleLabels = presentation.ruleLabels(t, pack, chapter)
      const details = [presentation.chapterDetails?.(t, pack, chapter),
        chapter.rules.inOrder ? t('Play in order') : t('Pick & choose'),
        ...ruleLabels.filter(label => label !== t('In order') && label !== t('Pick & choose'))]
        .filter(Boolean).join(' · ')
      return <article className={`pack-chapter-card pack-${chapter.theme}` + (locked ? ' is-locked' : '')} key={chapter.id}>
        <div className={'pack-chapter-art' + (chapterArt ? '' : ' is-empty')}>
          {chapterArt && <img src={chapterArt} alt=""/>}
          <span className="pack-chapter-badge">{t('Chapter {number}', { number: index + 1 })}</span>
        </div>
        <div className="pack-chapter-body">
          <div className="pack-chapter-heading">
            <h2>{t('{chapter} trail', { chapter: presentation.chapterTitle(t, pack, chapter) })}</h2>
            {locked ? <LockKeyhole size={20} aria-hidden="true"/>
              : progress.complete ? <Check size={20} aria-label={t('Completed')}/> : undefined}
          </div>
          {details && <p className="pack-chapter-details">{details}</p>}
          {locked
            ? <p className="pack-chapter-locked"><LockKeyhole size={15} aria-hidden="true"/>
              {t('Complete the previous chapter to unlock')}</p>
            : open ? <button className="primary pack-chapter-action" onClick={() => open(chapter.id)}>
              {t('Follow the trail')}<ChevronRight size={18} aria-hidden="true"/></button> : undefined}
          {preview && <p className="pack-chapter-preview-progress">
            {solvedText(t, progress.completed, progress.total)}</p>}
        </div>
      </article>
    })}</div>
    {!pack.data.chapters.length && <p className="empty">{t('Add a chapter to open its trail.')}</p>}
  </section>
}

/**
 * A chapter's trail. It keeps the upward, alternating stops and opens at the
 * current stop; the design adds the chapter progress line and ordering pill.
 */
export function PackRoadmap({ game, presentation, pack, chapterId, completed, sessions, canPlay, canExport, leave, play, preview = false,
  previewDetails, previewCompletions, tools, header, navigation }: {
  game: string; presentation: PackPresentation; pack: PackRevision; chapterId: string; completed: ReadonlySet<string>
  sessions: readonly SavedAttempt[]; canPlay: boolean; canExport: boolean; leave: () => void; play: (level: GameLevel) => void
  preview?: boolean; previewDetails?: ReadonlyMap<string, string | undefined>; previewCompletions?: readonly PackCompletion[]
  tools?: ReactNode; header?: ReactNode; navigation?: ReactNode
}) {
  const t = useT()
  const chapter = pack.data.chapters.find(item => item.id === chapterId) ?? pack.data.chapters[0]
  const chapterIndex = chapter ? Math.max(0, pack.data.chapters.findIndex(item => item.id === chapter.id)) : 0
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
    const previous = index > 0 ? levels[index - 1] : undefined
    return { id: level.id, title, state: locked ? 'locked' : solved[index] ? 'solved' : next === index ? 'next' : 'available',
      play: () => play(level), detail, actionLabel: action, actionName: t('{action} {title}', { action, title }),
      introduction: entry?.introduction, challenge: chapter ? presentation.challenge(t, pack, chapter, index + 1) : '',
      statusLabel: locked
        ? previous ? t('Solve {title} to unlock', { title: presentation.levelTitle(t, previous) })
          : t('Solve the previous stop to unlock')
        : solved[index] ? t('Solved') : next === index ? t('Up next') : undefined,
      bestTime: chapter && presentation.bestTime?.(t, pack, chapter, index + 1,
        matching.filter(item => item.data.completed).map(item => item.data)) }
  })
  return <section className={`catalog pack-roadmap pack-trail-screen pack-destination pack-${chapter?.theme ?? packTheme(pack)}`}>
    {navigation ? <div className="pack-screen-navigation">{navigation}</div> : <div className="game-navigation">
      <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {t(preview ? 'Back to editor' : 'Back')}</button>
      <div className="game-nav-tools">
        {tools}
        {canExport && <a className="icon-button" href={packExportUrl(pack)} download
          aria-label={t('Export pack')} title={t('Export pack')}><Download size={18}/></a>}
      </div>
    </div>}
    {header}
    {chapter && (preview ? <header className="pack-banner pack-screen-summary">
      {art && <img className="pack-backdrop" src={art} alt=""/>}
      <div className="pack-intro">{!header && <h1>{presentation.chapterTitle(t, pack, chapter)}</h1>}
        {description && <p>{description}</p>}
        <p>{levels.length
          ? [previewDetails && [...previewDetails.values()].some(detail => !detail) ? t('Ungraded') : presentation.chapterDetails?.(t, pack, chapter),
            solvedText(t, solved.filter(Boolean).length, levels.length)].filter(Boolean).join(' · ')
          : t('Add a level to preview the trail.')}</p>
        <ul className="pack-tags">{presentation.ruleLabels(t, pack, chapter).map(rule => <li className="badge" key={rule}>{rule}</li>)}</ul>
      </div>
    </header> : <div className="pack-trail-heading">
      <p className="pack-trail-meta">
        {[t('Chapter {number}', { number: chapterIndex + 1 }),
          levels.length ? solvedText(t, solved.filter(Boolean).length, levels.length)
            : t('Add a level to preview the trail.')].join(' · ')}
      </p>
      {chapter.rules.inOrder && <span className="pack-trail-pill">{t('Play in order')}</span>}
    </div>)}
    {locked ? <p className="chapter-locked-notice" role="status">
      <LockKeyhole size={20} aria-hidden="true"/> {t('Complete the previous chapter to unlock this chapter.')}
    </p> : stops.length > 0 && <PackTrail key={chapterPath(pack, chapter?.id ?? chapterId)} stops={stops} canPlay={canPlay} scrollToStop={!preview}/>}
  </section>
}
