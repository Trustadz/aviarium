import { ArrowRight, BookOpen, Check, Heart, Search, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import type { GameMetadata } from '../../../packages/game-sdk/src/index.js'
import { knownMessage, useT } from './i18n.js'

interface CatalogCard extends Pick<GameMetadata, 'id' | 'title' | 'tags' | 'eReader'> {
  description: string
  href: string
  artClass: string
  art: ReactNode
  favorite: boolean
  toggleFavorite?: () => void
  removeDownload?: () => void
}

export function GameCatalog({ studio, games, categories, query, setQuery, category, setCategory, link }: {
  studio: boolean
  games: readonly CatalogCard[]
  categories: readonly string[]
  query: string
  setQuery: (query: string) => void
  category: string
  setCategory: (category: string) => void
  link: (event: MouseEvent<HTMLAnchorElement>, href: string) => void
}) {
  const t = useT()
  const Heading = studio ? 'h1' : 'h2'
  const term = query.trim().toLowerCase()
  const matches = games.filter(game =>
    (category === 'All games' || (category === 'Favorites' ? game.favorite : game.tags.includes(category))) &&
    (game.title + ' ' + game.tags.map(tag => knownMessage(t, tag)).join(' ')).toLowerCase().includes(term))
  return <section className={'library' + (studio ? ' studio-catalog' : '')}>
    <div className="section-heading"><div><Heading>{t(studio ? 'Studio' : 'Game library')}</Heading>
      <p>{t('Browse by category or open your favorites.')}</p></div>
      <label className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)}
        placeholder={t('Search games')} aria-label={t('Search games')}/></label>
    </div>
    <div className="tabs" aria-label={t('Game categories')}>{categories.map(name =>
      <button key={name} aria-pressed={name === category} onClick={() => setCategory(name)}>{knownMessage(t, name)}</button>)}</div>
    <div className="game-list">{matches.map(game => <article className="game-card" key={game.id}>
      <a className={'game-card-image ' + game.artClass} href={game.href} onClick={event => link(event, game.href)}
        aria-label={t(studio ? 'Create for {game}' : 'Open {game}', { game: game.title })}>{game.art}</a>
      <div className="game-card-body">
        <div className="card-title">
          <h3><a href={game.href} onClick={event => link(event, game.href)}>{game.title}</a></h3>
          {game.toggleFavorite && <button className="icon-button" aria-label={t(game.favorite ? 'Remove {game} from favorites' : 'Add {game} to favorites', { game: game.title })}
            aria-pressed={game.favorite} onClick={game.toggleFavorite}><Heart size={19} fill={game.favorite ? 'currentColor' : 'none'}/></button>}
        </div>
        <p>{game.description}</p>
        <div className="card-footer">
          {game.tags.map(tag => <span className="badge" key={tag}>{knownMessage(t, tag)}</span>)}
          {game.eReader && <span className="badge e-ink"><BookOpen size={13}/> {t('E-reader')}</span>}
          <a className="text-button" href={game.href} onClick={event => link(event, game.href)}>
            {t(studio ? 'Edit' : 'Play')} <ArrowRight size={16}/>
          </a>
        </div>
        {game.removeDownload && <div className="game-download">
          <span><Check size={15}/> {t('Installed on this device')}</span>
          <button className="secondary" aria-label={t('Remove {game} download', { game: game.title })}
            onClick={game.removeDownload}><Trash2 size={15}/> {t('Remove download')}</button>
        </div>}
      </div>
    </article>)}</div>
    {!matches.length && <p className="empty">{t('No games match this view.')}</p>}
  </section>
}
