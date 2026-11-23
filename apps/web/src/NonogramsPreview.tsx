import type { CSSProperties } from 'react'
import type { Cell, Puzzle } from '../../../packages/nonograms/src/puzzles.js'

const bird = [
  '.....##',
  '....##.',
  '#..###.',
  '#####..',
  '.###...',
  '..#....',
  '.####..',
].join('')

export function NonogramsPreview({ puzzle, marks }: { puzzle?: Puzzle; marks?: Cell[] }) {
  const size = puzzle?.rows.length ?? 7
  const pixels = marks ?? (puzzle ? Array(size * size).fill(0) : Array.from(bird, pixel => pixel === '#' ? 1 : 0))
  return <div className="nonogram-preview" aria-hidden="true" style={{ '--preview-size': size } as CSSProperties}>
    {pixels.map((mark, index) => <span key={index} data-filled={mark === 1}/>)}
  </div>
}
