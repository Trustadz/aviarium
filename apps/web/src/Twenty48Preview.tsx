import { quickTwenty48, type Twenty48Level, type Twenty48Save } from '../../../packages/game-2048/src/contracts.js'
import { boardFromTiles, tilesFromBoard } from '../../../packages/game-2048/src/rules.js'
import './twenty48.css'

function Parrot() {
  return <svg className="twenty48-parrot" viewBox="0 0 120 120" role="img" aria-label="Parrot">
    <path className="parrot-tail" d="M73 67c14 9 21 25 17 41-11-7-17-17-18-28-4 10-10 18-19 23 3-17 9-28 20-36Z"/>
    <ellipse className="parrot-body" cx="57" cy="61" rx="29" ry="31" transform="rotate(-12 57 61)"/>
    <circle className="parrot-head" cx="61" cy="35" r="23"/>
    <path className="parrot-wing" d="M42 52c13-8 27-5 34 5-7 14-17 24-32 28-7-10-8-22-2-33Z"/>
    <path className="parrot-beak" d="M81 37c9 1 15 6 15 12-6 1-11-1-15-5-3-2-3-5 0-7Z"/>
    <circle className="parrot-eye" cx="70" cy="31" r="3.4"/>
    <path className="parrot-perch" d="M29 96h62" strokeLinecap="round"/>
  </svg>
}

export function Twenty48Preview({ level, attempt, thumbnail = false }: {
  level?: Twenty48Level; attempt?: Twenty48Save; thumbnail?: boolean
}) {
  const source = level?.content.start ?? quickTwenty48('preview', 1).content.start
  const board = attempt?.board ?? boardFromTiles(tilesFromBoard(source))
  return <div className="twenty48-preview" aria-hidden="true">
    <div className="twenty48-preview-board">
      {board.map((value, index) => <span key={index} className="twenty48-preview-cell" data-value={value}>
        {thumbnail ? '' : value || ''}
      </span>)}
    </div>
    {!thumbnail && <Parrot/>}
  </div>
}
