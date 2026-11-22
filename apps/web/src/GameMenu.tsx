import { ArrowLeft, BookOpen, History, Settings2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useT } from './i18n.js'

export function GameMenu({ title, leave, guide, history, settings, children }: {
  title: string
  leave: () => void
  guide?: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }
  history?: () => void
  settings?: { label: string; open: () => void }
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
          {history && <button className="text-button" onClick={history}><History size={17}/> {t('History')}</button>}
          {settings && <button className="icon-button" aria-label={settings.label} title={settings.label}
            onClick={settings.open}><Settings2 size={18}/></button>}
        </div>
      </div>
      <div className="game-navigation">
        <h1 id="game-menu-title">{title}</h1>
        {guide && <a className="text-button" href={guide.href} onClick={guide.open}><BookOpen size={17}/> {t('How to play')}</a>}
      </div>
    </div>
    {children}
  </section>
}
