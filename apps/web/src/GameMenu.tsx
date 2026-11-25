import { ArrowLeft, BookOpen, History, Pencil, Settings2, Trophy } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useT } from './i18n.js'

export function GameNavigation({ leave, history, settings, leaderboard, extraTools }: {
  leave: () => void
  history?: () => void
  settings?: { label: string; open: () => void }
  leaderboard?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  extraTools?: ReactNode
}) {
  const t = useT()
  return <div className="game-navigation">
    <button className="text-button back" onClick={leave}>
      <ArrowLeft size={17}/> {t('Back')}
    </button>
    <div className="game-nav-tools">
      {leaderboard && <a className="icon-button" href={leaderboard.href} onClick={leaderboard.open}
        aria-label={t('Leaderboard')} title={t('Leaderboard')}><Trophy size={18}/></a>}
      {history && <button className="icon-button" aria-label={t('History')} title={t('History')}
        onClick={history}><History size={18}/></button>}
      {settings && <button className="icon-button" aria-label={settings.label} title={settings.label}
        onClick={settings.open}><Settings2 size={18}/></button>}
      {extraTools}
    </div>
  </div>
}

export function GameHeading({ title, gameTitle, titleId, guide, editor }: {
  title: string
  /** The game name used for labels that would otherwise repeat a pack title. */
  gameTitle?: string
  titleId?: string
  guide?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  editor?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
}) {
  const t = useT()
  return <div className="game-menu-heading-body">
    <div className="game-navigation">
      <h1 id={titleId}>{title}</h1>
      {guide && <a className="text-button" href={guide.href} onClick={guide.open}><BookOpen size={17}/> {t('How to play')}</a>}
    </div>
    {editor && <div className="game-menu-action">
      <a className="secondary" href={editor.href} onClick={editor.open}
        aria-label={t('My packs for {game}', { game: gameTitle ?? title })}>
        <Pencil size={16} aria-hidden="true"/> {t('My packs')}
      </a>
    </div>}
  </div>
}

export function GameHeader({ title, gameTitle, titleId, leave, guide, history, settings, leaderboard, editor, extraTools }: {
  title: string
  gameTitle?: string
  titleId?: string
  leave: () => void
  guide?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  history?: () => void
  settings?: { label: string; open: () => void }
  leaderboard?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  editor?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  extraTools?: ReactNode
}) {
  return <div className="game-menu-heading">
    <GameNavigation leave={leave} history={history} settings={settings} leaderboard={leaderboard} extraTools={extraTools}/>
    <GameHeading title={title} gameTitle={gameTitle} titleId={titleId} guide={guide} editor={editor}/>
  </div>
}

export function GameMenu({ title, leave, guide, history, settings, leaderboard, editor, children }: {
  title: string
  leave: () => void
  guide?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  history?: () => void
  settings?: { label: string; open: () => void }
  leaderboard?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  editor?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  children: ReactNode
}) {
  return <section className="catalog game-menu" aria-labelledby="game-menu-title">
    <GameHeader title={title} titleId="game-menu-title" leave={leave} guide={guide} history={history}
      settings={settings} leaderboard={leaderboard} editor={editor}/>
    {children}
  </section>
}
