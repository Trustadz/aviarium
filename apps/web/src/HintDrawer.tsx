import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { Lightbulb, X } from 'lucide-react'
import type { LogicalStep } from '../../../packages/sudoku/src/logic.js'
import { column, row } from '../../../packages/sudoku/src/rules.js'
import { useT } from './i18n.js'
import type { Message } from './messages.js'
import { technique } from './sudoku-copy.js'

/**
 * One visible hint. A logical step is progressive; a message describes a board
 * problem or a position where the solver has no supported deduction.
 */
export type Hint = { cells?: readonly number[]; kind?: 'conflict' | 'unsolvable' | 'none' } &
  ({ stage: 1 | 2 | 3; step: LogicalStep } | { stage?: never; message: Message })

interface Props {
  hint: Hint
  open: boolean
  hintsUsed: number
  onClose: () => void
  onAdvance: () => void
  onApply: () => void
}

const errorTitles = {
  conflict: 'Resolve the conflict',
  unsolvable: 'No solution from here',
  none: 'No hint available',
} as const satisfies Record<NonNullable<Hint['kind']>, Message>

function stepExplanation(t: ReturnType<typeof useT>, step: LogicalStep) {
  return step.diagonal ? t('Find a digit that can fit in only one cell of a diagonal.')
    : step.id === 'hidden-single' ? t('Find a digit that can fit in only one cell of a row, column, or box.')
      : step.id === 'naked-single' || step.id === 'open-singles' ? t('Find an empty cell with just one possible digit.')
        : step.type === 'elimination' ? t('Find the pattern to identify which candidates it rules out.')
          : undefined
}

/**
 * A non-modal hint panel docked to the play footer. It is absolutely positioned
 * and never participates in the controls' flow, so opening a hint cannot resize
 * the board. The board stays visible and interactive while the panel is open.
 */
export function HintDrawer({ hint, open, hintsUsed, onClose, onAdvance, onApply }: Props) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dragStart = useRef<number | undefined>(undefined)
  const [drag, setDrag] = useState(0)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) {
      const active = document.activeElement
      if (!active || active === document.body || panel.current?.contains(active)) returnFocus.current?.focus()
      return
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => panel.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [onClose, open])

  const view = (() => {
    if (!hint.stage) return {
      stage: undefined,
      title: t(errorTitles[hint.kind ?? 'none']),
      body: t(hint.message),
      action: { label: t('Close'), run: onClose },
    }
    const { stage, step } = hint
    const cellText = (index: number) =>
      t('row {row}, column {column}', { row: row(index) + 1, column: column(index) + 1 })
    if (stage === 3) return {
      stage,
      title: t('The deduction'),
      body: step.updates.map(({ index, filledValue, eliminatedCandidate }) => filledValue
        ? t('Place {digit} in {cell}.', { digit: filledValue, cell: cellText(index) })
        : t('Eliminate {digit} from {cell}.', { digit: eliminatedCandidate!, cell: cellText(index) })).join(' '),
      action: step.type === 'elimination'
        ? { label: t('Apply deduction'), run: onApply }
        : { label: t('Done'), run: onClose },
    }
    return {
      stage,
      title: technique(t, step),
      body: stage === 1
        ? stepExplanation(t, step) ?? t('Look for this pattern on the board.')
        : t('Look at the highlighted cells on the board.'),
      action: stage === 1
        ? { label: t('Show me where'), run: onAdvance }
        : { label: t('Reveal the deduction'), run: onAdvance },
    }
  })()
  const count = hintsUsed === 0 ? t('No hints used')
    : t('{count, plural, one {# hint} other {# hints}} used', { count: hintsUsed })

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    dragStart.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current === undefined) return
    setDrag(Math.max(0, event.clientY - dragStart.current))
  }
  function endDrag() {
    if (dragStart.current === undefined) return
    dragStart.current = undefined
    if (drag > 56) onClose()
    else setDrag(0)
  }

  return <div ref={panel} id="sudoku-hint" role="dialog" aria-modal="false" aria-labelledby={titleId}
    aria-describedby={bodyId} tabIndex={-1} className="hint-drawer" data-open={open}
    data-dragging={drag > 0 || undefined} inert={!open}
    style={drag ? { transform: `translateY(${drag}px)` } : undefined}>
    <div className="hint-drawer-grip" aria-hidden="true" onPointerDown={startDrag}
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}/>
    <header className="hint-drawer-head">
      <span className="hint-drawer-icon" aria-hidden="true"><Lightbulb size={19}/></span>
      <div className="hint-drawer-heading">
        <p className="eyebrow">{view.stage ? t('Hint · Step {step} of 3', { step: view.stage }) : t('Hint')}</p>
        <h2 id={titleId}>{view.title}</h2>
      </div>
      <button type="button" className="icon-button hint-drawer-close" aria-label={t('Close hint')}
        onClick={onClose}><X size={18}/></button>
    </header>
    <p id={bodyId} className="hint-drawer-body" aria-live="polite">{view.body}</p>
    <footer className="hint-drawer-foot">
      <span className="hint-drawer-count" title={t('Hints are shown on the leaderboard but never change your rank.')}>
        <Lightbulb size={14} aria-hidden="true"/>{count}
      </span>
      <button type="button" className="primary hint-drawer-action" onClick={view.action.run}>{view.action.label}</button>
    </footer>
  </div>
}
