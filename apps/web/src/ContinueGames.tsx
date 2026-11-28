import { useT } from './i18n.js'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Ellipsis, Trash2 } from 'lucide-react'
import './continue.css'

export type DailyStatus = 'available' | 'started' | 'completed'

export interface ContinueGame {
  id: string
  /** The game this card belongs to. Used to keep a game menu's row scoped. */
  game: string
  title: string
  details: string
  progress?: string
  /** An already formatted daily-challenge result, shown after the detail. */
  result?: string
  preview?: ReactNode
  canResume: boolean
  removable?: boolean
  daily?: boolean
  dailyStatus?: DailyStatus
}

interface Props {
  games: readonly ContinueGame[]
  resume: (id: string) => void
  remove: (id: string) => void
}

/** Matches the pointer breakpoint used by continue.css for the swipe delete. */
const touchPointer = '(hover: none), (pointer: coarse)'
const focusable = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function actionLabel(t: ReturnType<typeof useT>, game: ContinueGame) {
  if (!game.daily) return t('Resume')
  if (game.dailyStatus === 'completed') return t('View result')
  if (game.dailyStatus === 'started') return t('Resume challenge')
  return t('Start challenge')
}

/** Small warm-palette artwork that sets the daily card apart from saved games. */
function DailyChallengeArt() {
  return <svg className="continue-daily-art" viewBox="0 0 36 28" aria-hidden="true" focusable="false">
    <rect className="continue-daily-art-page" x="1.5" y="5.5" width="22" height="20" rx="4"/>
    <path className="continue-daily-art-band" d="M1.5 9.5a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4V12h-22Z"/>
    <circle className="continue-daily-art-sun" cx="27.5" cy="8" r="7"/>
    <path className="continue-daily-art-star" d="m27.5 3.6.9 2.5 2.6.2-2 1.7.7 2.5-2.2-1.4-2.2 1.4.7-2.5-2-1.7 2.6-.2Z"/>
    <rect className="continue-daily-art-mark" x="6.5" y="15.5" width="4.5" height="4.5" rx="1"/>
    <rect className="continue-daily-art-mark is-soft" x="14" y="15.5" width="4.5" height="4.5" rx="1"/>
    <rect className="continue-daily-art-line" x="6.5" y="22.5" width="12" height="2" rx="1"/>
  </svg>
}

export function ContinueGames({ games, resume, remove }: Props) {
  const t = useT()
  const heading = useId()
  const track = useRef<HTMLUListElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const [openOptions, setOpenOptions] = useState<string>()
  const [revealed, setRevealed] = useState<string>()
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const updateEdges = useCallback(() => {
    const element = track.current
    if (!element) return
    setAtStart(element.scrollLeft <= 2)
    setAtEnd(element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const element = track.current
    if (!element) return
    updateEdges()
    element.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)
    const observer = new ResizeObserver(updateEdges)
    observer.observe(element)
    element.querySelectorAll('.continue-item').forEach(item => observer.observe(item))
    return () => {
      element.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
      observer.disconnect()
    }
  }, [games.length, updateEdges])

  useEffect(() => {
    if (!openOptions) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && options.current?.contains(event.target)) return
      setOpenOptions(undefined)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [openOptions])

  useEffect(() => {
    if (!revealed) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest('[data-continue-revealed]')) return
      setRevealed(undefined)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [revealed])

  // A swipe up on a saved card reveals its delete action. Run only for touch
  // pointers so a mouse drag never opens the phone-only control.
  useEffect(() => {
    const element = track.current
    if (!element || !window.matchMedia(touchPointer).matches) return
    let card: HTMLElement | null = null
    let startX = 0
    let startY = 0
    let swiping = false
    function start(event: TouchEvent) {
      card = null
      swiping = false
      if (event.touches.length !== 1) return
      const target = event.target
      const candidate = target instanceof Element ? target.closest<HTMLElement>('[data-continue-card]') : null
      if (!candidate || candidate.hasAttribute('data-continue-daily')) return
      card = candidate
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    }
    function move(event: TouchEvent) {
      if (!card || event.touches.length !== 1) return
      const dx = event.touches[0].clientX - startX
      const dy = event.touches[0].clientY - startY
      if (!swiping) {
        if (Math.abs(dx) > Math.abs(dy) || dy >= 0) { card = null; return }
        if (dy > -12) return
        swiping = true
      }
      event.preventDefault()
    }
    function end() {
      if (card && swiping) {
        const id = card.dataset.continueCard
        if (id) setRevealed(current => current === id ? undefined : id)
      }
      card = null
      swiping = false
    }
    function cancel() {
      card = null
      swiping = false
    }
    element.addEventListener('touchstart', start, { passive: true })
    element.addEventListener('touchmove', move, { passive: false })
    element.addEventListener('touchend', end)
    element.addEventListener('touchcancel', cancel)
    return () => {
      element.removeEventListener('touchstart', start)
      element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', end)
      element.removeEventListener('touchcancel', cancel)
    }
  }, [games.length])

  function scrollByCard(direction: -1 | 1) {
    const element = track.current
    if (!element) return
    const card = element.querySelector<HTMLElement>('.continue-item')
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 12
    element.scrollBy({
      left: direction * ((card?.offsetWidth ?? 154) + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })
  }

  function scrollToEdge(edge: 'start' | 'end') {
    const element = track.current
    if (!element) return
    element.scrollTo({ left: edge === 'start' ? 0 : element.scrollWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function key(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      scrollByCard(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      scrollByCard(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      scrollToEdge('start')
    } else if (event.key === 'End') {
      event.preventDefault()
      scrollToEdge('end')
    }
  }

  function keepInView(target: EventTarget | null) {
    const element = track.current
    if (!element || !(target instanceof HTMLElement)) return
    const item = target.closest<HTMLElement>('.continue-item')
    if (!item) return
    const trackRect = element.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const margin = 8
    let left = 0
    if (itemRect.left < trackRect.left + margin) left = itemRect.left - trackRect.left - margin
    else if (itemRect.right > trackRect.right - margin) left = itemRect.right - trackRect.right + margin
    if (left) element.scrollBy({ left, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function dismissOptions(restoreFocus: boolean) {
    if (restoreFocus) options.current?.querySelector<HTMLButtonElement>(focusable)?.focus()
    setOpenOptions(undefined)
  }

  if (!games.length) return null

  return <section className="continue-games" aria-labelledby={heading}>
    <div className="continue-heading">
      <h2 id={heading}>{t('Continue')}</h2>
      <div className="continue-viewport-controls">
        <button type="button" className="continue-scroll" aria-label={t('Previous games')}
          disabled={atStart} onClick={() => scrollByCard(-1)}><ChevronLeft size={20} aria-hidden="true"/></button>
        <button type="button" className="continue-scroll" aria-label={t('Next games')}
          disabled={atEnd} onClick={() => scrollByCard(1)}><ChevronRight size={20} aria-hidden="true"/></button>
      </div>
    </div>
    <ul className="continue-track" ref={track} tabIndex={0} aria-labelledby={heading}
      onKeyDown={key} onFocus={event => keepInView(event.target)}>
      {games.map((game, index) => {
        const detail = game.daily
          ? [game.details, game.result].filter(Boolean).join(' · ')
          : game.progress || game.details
        const titleId = heading + '-title-' + index
        const saved = game.removable !== false && !game.daily
        return <li key={game.id} className={'continue-item' + (game.daily ? ' continue-item-daily' : '')}
          data-continue-card={game.id}
          data-continue-daily={game.daily ? 'true' : undefined}
          data-continue-revealed={revealed === game.id ? 'true' : undefined}>
          <article className={'continue-card' + (game.daily ? ' continue-card-daily' : '')} aria-labelledby={titleId}>
            {game.daily
              ? <div className="continue-card-head continue-card-head-daily">
                <div className="continue-card-copy">
                  <h3 className="continue-card-title" id={titleId}>{t('Daily challenge')}
                    <span className="visually-hidden"> · {game.title}</span></h3>
                  <p className="continue-card-detail">{detail}</p>
                </div>
                <span className="continue-daily-art-slot"><DailyChallengeArt/></span>
              </div>
              : <div className="continue-card-head">
                <div className="continue-thumb" aria-hidden="true">{game.preview}</div>
                <div className="continue-card-copy">
                  <h3 className="continue-card-title" id={titleId}>{game.title}</h3>
                  <p className="continue-card-detail">{detail}</p>
                </div>
              </div>}
            <button type="button" className={'continue-card-action' + (game.daily ? ' continue-card-action-daily' : '')}
              data-status={game.dailyStatus} disabled={!game.canResume} onClick={() => resume(game.id)}>
              {actionLabel(t, game)}
            </button>
            {saved && <div className="continue-menu" ref={openOptions === game.id ? options : undefined}
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpenOptions(undefined)
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape' || openOptions !== game.id) return
                event.stopPropagation()
                dismissOptions(true)
              }}>
              <button type="button" className="continue-menu-button"
                aria-label={t('More options for {game}', { game: game.title })} title={t('Saved game options')}
                aria-expanded={openOptions === game.id}
                onClick={() => setOpenOptions(openOptions === game.id ? undefined : game.id)}><Ellipsis size={20}/></button>
              {openOptions === game.id && <div className="continue-menu-panel">
                <button type="button" className="continue-menu-delete" onClick={() => {
                  dismissOptions(false)
                  remove(game.id)
                }}><Trash2 size={15} aria-hidden="true"/>{" "}{t('Delete save')}</button>
              </div>}
            </div>}
          </article>
          {saved && <div className="continue-swipe">
            <div className="continue-swipe-inner">
              <button type="button" className="continue-swipe-delete" onClick={() => {
                setRevealed(undefined)
                remove(game.id)
              }}><Trash2 size={16} aria-hidden="true"/>{" "}{t('Delete save')}</button>
            </div>
          </div>}
        </li>
      })}
    </ul>
  </section>
}
