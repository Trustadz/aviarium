import { ArrowLeft, BookOpen, ChevronRight, History, Pencil, Settings2, Trophy } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useT } from './i18n.js'
import './game-menu.css'

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

export interface GameMenuItem {
  key: string
  label: string
  icon: ReactNode
  href: string
  open: (event: MouseEvent<HTMLAnchorElement>) => void
}

/**
 * The shared game-menu links. The platform decides which capabilities exist and
 * supplies them in contract order; this component only renders the list.
 */
export function GameMenuLinks({ items, label }: { items: readonly GameMenuItem[]; label: string }) {
  if (!items.length) return null
  return <nav className="game-menu-destinations" aria-label={label}>
    {items.map(item => <a key={item.key} className="game-menu-destination" href={item.href} onClick={item.open}>
      <span className="game-menu-destination-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
      <ChevronRight className="game-menu-destination-chevron" size={20} aria-hidden="true"/>
    </a>)}
  </nav>
}

/**
 * Player-facing game menu shell. Title, mascot and the back target stay in the
 * platform; the game supplies only its title, theme and optional mascot art.
 */
export function GameMenu({ title, gameId, mascot, leave, backLabel, children }: {
  title: string
  gameId?: string
  mascot?: string
  leave: () => void
  backLabel?: string
  children: ReactNode
}) {
  const t = useT()
  return <section className="catalog game-menu-page" aria-labelledby="game-menu-title">
    <div className="game-menu-top">
      <button className="text-button game-menu-back" onClick={leave}>
        <ArrowLeft size={17}/> {backLabel ?? t('Library')}
      </button>
      <div className="game-menu-title-row">
        <h1 id="game-menu-title">{title}</h1>
        {mascot && <img className={'game-menu-mascot game-menu-mascot-' + (gameId ?? 'generic')}
          src={mascot} alt="" aria-hidden="true"/>}
      </div>
    </div>
    {children}
  </section>
}
