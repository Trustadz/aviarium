import { ArrowLeft, BookOpen, History, Pencil, Settings2, Trophy } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useT } from './i18n.js'

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
  const t = useT()
  return <section className="catalog game-menu" aria-labelledby="game-menu-title">
    <div className="game-menu-heading">
      <div className="game-navigation">
        <button className="text-button back" aria-label={t('Exit to library')} onClick={leave}>
          <ArrowLeft size={17}/> {t('Library')}
        </button>
        <div className="game-nav-tools">
          {leaderboard && <a className="icon-button" href={leaderboard.href} onClick={leaderboard.open}
            aria-label={t('Leaderboard')} title={t('Leaderboard')}><Trophy size={18}/></a>}
          {history && <button className="icon-button" aria-label={t('History')} title={t('History')}
            onClick={history}><History size={18}/></button>}
          {settings && <button className="icon-button" aria-label={settings.label} title={settings.label}
            onClick={settings.open}><Settings2 size={18}/></button>}
        </div>
      </div>
      <div className="game-navigation">
        <h1 id="game-menu-title">{title}</h1>
        {guide && <a className="text-button" href={guide.href} onClick={guide.open}><BookOpen size={17}/> {t('How to play')}</a>}
      </div>
      {editor && <div className="game-menu-action">
        <a className="secondary" href={editor.href} onClick={editor.open}
          aria-label={t('My packs for {game}', { game: title })}>
          <Pencil size={16} aria-hidden="true"/> {t('My packs')}
        </a>
      </div>}
    </div>
    {children}
  </section>
}
