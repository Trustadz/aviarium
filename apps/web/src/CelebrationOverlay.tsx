import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight } from 'lucide-react'
import { BudgieFlock, CelebrationBurst, CelebrationSparkle } from './celebrations.js'
import { useT } from './i18n.js'
import { displayTime } from './SudokuMenu.js'
import './celebrations.css'

export interface CelebrationStat {
  label: string
  value: string
}

export interface CelebrationAction {
  label: string
  onClick: () => void
  kind?: 'primary' | 'secondary' | 'text'
}

export interface CelebrationValue {
  label: string
  value: string
  /** Formatted previous best, when the game has one. */
  best?: string
  newBest?: boolean
}

export interface CelebrationResult {
  /** Time games pass elapsedMs; score games pass a primary value instead. */
  elapsedMs?: number
  bestMs?: number
  primary?: CelebrationValue
  description?: string
  stats: readonly CelebrationStat[]
  saveNote?: string
  saveError?: boolean
}

const resultsLeadMs = 2500

export function CelebrationOverlay({ result, actions, onClose, reader, preview = false, celebrate = true, children, heading }: {
  result: CelebrationResult
  actions: readonly CelebrationAction[]
  onClose: () => void
  reader: boolean
  preview?: boolean
  /** A loss may show the result card without the flock and confetti. */
  celebrate?: boolean
  children?: ReactNode
  heading?: string
}) {
  const t = useT()
  const [reduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [celebrating, setCelebrating] = useState(() => celebrate && !reduced)
  const overlay = useRef<HTMLDivElement>(null)
  const results = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const duration = reader ? 3200 : 3600
  const title = heading ?? t(preview ? 'Celebration preview' : 'Puzzle solved')
  const newBest = result.primary?.newBest ?? (result.bestMs !== undefined && result.elapsedMs !== undefined && result.elapsedMs < result.bestMs)
  const primary = result.primary ?? (result.elapsedMs !== undefined ? {
    label: t('Time'), value: displayTime(result.elapsedMs),
    best: result.bestMs !== undefined ? displayTime(result.bestMs) : undefined,
    newBest,
  } : undefined)

  useEffect(() => {
    if (!celebrating) return
    const timer = window.setTimeout(() => setCelebrating(false), duration)
    return () => window.clearTimeout(timer)
  }, [celebrating, duration])

  useEffect(() => {
    const game = document.querySelector<HTMLElement>('main')
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const overflow = document.body.style.overflow
    const hidden = game?.getAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    game?.setAttribute('inert', '')
    game?.setAttribute('aria-hidden', 'true')
    const frame = window.requestAnimationFrame(() => results.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      game?.removeAttribute('inert')
      if (hidden === null || hidden === undefined) game?.removeAttribute('aria-hidden')
      else if (game) game.setAttribute('aria-hidden', hidden)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = overlay.current
      if (!root) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return createPortal(<div ref={overlay} className="celebration-overlay" data-reader={reader}
    role="dialog" aria-modal="true" data-phase={celebrating ? 'celebrate' : 'results'}
    aria-label={title}
    style={{ '--results-reveal-at': `${duration - resultsLeadMs}ms` } as CSSProperties}>
    <div className="celebration-scrim" aria-hidden="true"/>
    <div className="celebration-glow" aria-hidden="true"/>
    {celebrating && <BudgieFlock/>}
    <div className="celebration-burst" aria-hidden="true"><CelebrationBurst/></div>
    <div className="celebration-sparkle" aria-hidden="true"><CelebrationSparkle/></div>
    <div className="celebration-flash" aria-hidden="true"/>
    <section ref={results} className="celebration-results" tabIndex={-1}>
      <div className="celebration-results-card">
        <div className="celebration-result-head">
          <h2 id="celebration-result-title">{title}</h2>
        </div>
        {!preview && primary && <div className="celebration-time">
          <span>{primary.label}</span>
          <strong>{primary.value}</strong>
          {primary.newBest ? <span className="celebration-best is-new">{result.primary ? t('New best') : t('New best time')}</span>
            : primary.best !== undefined ? <span className="celebration-best">{result.primary ? t('Best {value}', { value: primary.best }) : t('Best {time}', { time: primary.best })}</span>
              : null}
        </div>}
        {result.description && <p className="celebration-line">{result.description}</p>}
        <dl className="celebration-stats">
          {result.stats.map(stat => <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>)}
        </dl>
        {children}
        {result.saveNote && <p className={result.saveError ? 'celebration-save error' : 'celebration-save'}
          role={result.saveError ? 'alert' : undefined}>{result.saveNote}</p>}
        <div className="celebration-actions">
          {actions.map(action => <button type="button" key={action.label}
            className={action.kind === 'primary' ? 'primary' : action.kind === 'text' ? 'text-button' : 'secondary'}
            onClick={action.onClick}>
            {action.kind === 'primary' && <ArrowRight size={17}/>} {action.label}
          </button>)}
        </div>
      </div>
    </section>
  </div>, host())
}

function host() {
  return document.querySelector<HTMLElement>('.app') ?? document.body
}
