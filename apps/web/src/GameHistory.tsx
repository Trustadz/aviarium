import { ArrowLeft } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import type { WebGame } from './game-web.js'
import { useT } from './i18n.js'
import { levelKey, type LocalSession } from './storage.js'

export function GameHistory({ game, sessions, levels, packs, leave, replay, canPlay }: {
  game: WebGame; sessions: readonly LocalSession[]; levels: ReadonlyMap<string, GameLevel>; packs: readonly PackRevision[]
  leave: () => void; replay: (level: GameLevel) => void; canPlay: boolean
}) {
  const t = useT()
  const { formatDate } = useIntl()
  const date = (session: LocalSession) => session.data.completedAt ?? session.updated
  const history = sessions.filter(item => item.data.game === game.id && item.data.completed).sort((a, b) => date(b) - date(a))
  return <section className="catalog game-history">
    <button className="text-button back" onClick={leave}><ArrowLeft size={17}/> {game.packs ? t(game.packs.menuLabel) : game.title}</button>
    <h1>{t('History')}</h1>
    {!history.length && <p>{t('No completed puzzles yet.')}</p>}
    <ul className="history-list">{history.map(item => {
      const level = levels.get(levelKey(item.data.level, item.data.levelRevision))
      const pack = level?.pack && packs.find(pack => pack.id === level.pack?.id && pack.revision === level.pack.revision)
      return <li className="panel history-card" key={item.id}>
        {level && <div className="continue-preview">{game.preview(level, item.data)}</div>}
        <div className="history-card-info"><h2>{level ? game.levelTitle(t, level) : game.title}</h2>
          <p>{[level && game.packs?.detail(t, level), pack && game.packs ? game.packs.title(t, pack) : level?.pack ? t('Pack') : undefined,
            game.resultDetail(t, level, item.data), date(item) > 0 ? formatDate(new Date(date(item))) : undefined]
            .filter(Boolean).join(' · ')}</p></div>
        {level && <div className="button-bar">
          {game.share?.(level)}
          <button className="secondary" disabled={!canPlay} onClick={() => replay(level)}>{t('Replay')}</button>
        </div>}
      </li>
    })}</ul>
  </section>
}
