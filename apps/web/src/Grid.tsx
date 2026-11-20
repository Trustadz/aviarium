import { useRef, type KeyboardEvent } from 'react'
import { bit, box, cells, column, row } from '../../../packages/sudoku/src/rules.js'

interface GridProps {
  entries: readonly number[]; givens?: readonly number[]; notes?: readonly number[]
  selected: number; select: (cell: number) => void; enter: (digit: number) => void
  activate?: (cell: number) => void; highlightedDigit?: number; hintCell?: number
  errors?: ReadonlySet<number>; disabled?: boolean; related?: boolean
}
function cellClasses(cell: number, selected: number, given: boolean, related = true, wrong = false) {
  return ['cell', given ? 'given' : 'entry', wrong && 'wrong',
    selected === cell ? 'selected' : related && (row(cell) === row(selected) || column(cell) === column(selected) || box(cell) === box(selected)) && 'related',
    column(cell) % 3 === 2 && column(cell) !== 8 && 'box-end',
    row(cell) % 3 === 2 && row(cell) !== 8 && 'box-bottom',
  ].filter(Boolean).join(' ')
}

export function SudokuPreview({ grid, entries }: { grid?: string; entries?: readonly number[] }) {
  const previewGivens = Array.from(grid ?? '', Number)
  const previewSelection = entries ? -1 : previewGivens.indexOf(0)
  return <div className={entries ? 'board saved-board' : 'board'} aria-hidden="true">
    {(entries ?? previewGivens).map((value, cell) =>
      <span key={cell} className={cellClasses(cell, previewSelection, Boolean(previewGivens[cell]), !entries)}>{value || ''}</span>)}
  </div>
}

export function Grid({ entries, givens, notes, selected, select, enter, activate = select, highlightedDigit,
  hintCell, errors, disabled, related = true }: GridProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  function key(event: KeyboardEvent<HTMLButtonElement>, cell: number) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const offsets: Record<string, number> = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }
    if (event.key in offsets) {
      event.preventDefault()
      const next = Math.max(0, Math.min(80, cell + offsets[event.key]))
      select(next); buttons.current[next]?.focus()
    } else if (/^[0-9]$/.test(event.key) || ['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault()
      enter(Number(event.key) || 0)
    }
  }
  return <div className="board" aria-label="Sudoku board">
    {cells.map(cell => {
      const value = entries[cell], mask = notes?.[cell] ?? 0
      const matching = Boolean(value && value === highlightedDigit)
      const hinted = cell === hintCell
      const classes = cellClasses(cell, selected, Boolean(givens?.[cell]), related, errors?.has(cell))
      return <button key={cell} type="button" className={classes + (matching ? ' matching' : '') + (hinted ? ' hinted' : '')} ref={element => { buttons.current[cell] = element }}
        tabIndex={selected === cell ? 0 : -1} aria-pressed={selected === cell} disabled={disabled}
        aria-label={`Row ${row(cell) + 1}, column ${column(cell) + 1}, ${value || 'empty'}${givens?.[cell] ? ', given' : ''}${hinted ? ', hint target' : ''}`}
        onFocus={() => select(cell)} onClick={() => activate(cell)} onKeyDown={event => key(event, cell)}>
        {value || (mask ? <span className="cell-notes">{Array.from({ length: 9 }, (_, i) =>
          <span key={i}>{mask & bit(i + 1) ? i + 1 : ''}</span>)}</span> : '')}
      </button>
    })}
  </div>
}
