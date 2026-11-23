import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, X } from 'lucide-react'
import { BudgieFlock, CelebrationBurst, CelebrationSparkle, celebrationStyleFor, type CelebrationVisitor } from './celebrations.js'
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

export interface CelebrationResult {
  elapsedMs: number
  bestMs?: number
  stats: readonly CelebrationStat[]
  saveNote?: string
  saveError?: boolean
}

export function CelebrationOverlay({ visitor, result, actions, onClose, reader, preview = false }: {
  visitor: CelebrationVisitor
  result: CelebrationResult
  actions: readonly CelebrationAction[]
  onClose: () => void
  reader: boolean
  preview?: boolean
}) {
  const t = useT()
  const [celebrating, setCelebrating] = useState(true)
  const [reduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const overlay = useRef<HTMLDivElement>(null)
  const skip = useRef<HTMLButtonElement>(null)
  const results = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const duration = reduced ? 1000 : reader ? 3200 : 3600
  const title = t(preview ? 'Celebration preview' : 'Puzzle solved')
  const newBest = result.bestMs !== undefined && result.elapsedMs < result.bestMs

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
    data-species={visitor.id} style={celebrationStyleFor(visitor)} role="dialog" aria-modal="true" data-phase={celebrating ? 'celebrate' : 'results'}
    aria-label={title} aria-describedby="celebration-visitor">
    <p id="celebration-visitor" className="sr-only">{t(visitor.name)}. {t(visitor.line)}</p>
    <div className="celebration-glow" aria-hidden="true"/>
    <div className="celebration-flock" aria-hidden="true"><BudgieFlock/></div>
    <div className="celebration-burst" aria-hidden="true"><CelebrationBurst/></div>
    <div className="celebration-sparkle" aria-hidden="true"><CelebrationSparkle/></div>
    <div className="celebration-flash" aria-hidden="true"/>
    <header className="celebration-top">
      {celebrating && <button type="button" ref={skip} className="celebration-skip" onClick={() => setCelebrating(false)}>
        {t('Skip celebration')}
      </button>}
      <button type="button" className="celebration-close" aria-label={t('Close')} onClick={() => closeRef.current()}><X size={20}/></button>
    </header>
    <section ref={results} className="celebration-results" tabIndex={-1}>
      <div className="celebration-results-card">
        <div className="celebration-result-head">
          <p className="eyebrow">{t('A visitor from the aviary')}</p>
          <h2 id="celebration-result-title">{title}</h2>
          <p className="celebration-species">{t(visitor.name)}</p>
          <p className="celebration-line">{t(visitor.line)}</p>
        </div>
        {!preview && <div className="celebration-time">
          <span>{t('Time')}</span>
          <strong>{displayTime(result.elapsedMs)}</strong>
          {newBest ? <span className="celebration-best is-new">{t('New best time')}</span>
            : result.bestMs !== undefined ? <span className="celebration-best">{t('Best {time}', { time: displayTime(result.bestMs) })}</span>
              : null}
        </div>}
        <dl className="celebration-stats">
          {result.stats.map(stat => <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>)}
        </dl>
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
