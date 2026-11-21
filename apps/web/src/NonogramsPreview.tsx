const bird = [
  '.....##',
  '....##.',
  '#..###.',
  '#####..',
  '.###...',
  '..#....',
  '.####..',
].join('')

export function NonogramsPreview() {
  return <div className="nonogram-preview" aria-hidden="true">
    {Array.from(bird, (pixel, index) => <span key={index} data-filled={pixel === '#'}/>)}
  </div>
}
