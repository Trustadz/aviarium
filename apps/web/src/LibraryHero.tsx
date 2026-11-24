import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import type { PackRevision } from '../../../packages/game-sdk/src/packs.js'
import { starterPack } from '../../../packages/nonograms/src/puzzles.js'
import type { WebGame } from './game-web.js'
import { useT } from './i18n.js'
import type { Message } from './messages.js'
import { findGame } from './registry.js'

const slides = [
  {
    game: 'sudoku', title: 'Aviarium', label: 'PUZZLE LIBRARY',
    description: 'A quiet place to play. Find your next puzzle or pick up where you left off.',
  },
  {
    game: 'nonograms', title: 'Nonograms', label: 'New game',
    description: 'Use row and column clues to reveal a picture. Start with the Sulphur-crested Cockatoos pack.',
  },
] as const satisfies readonly { game: string; title: string; label: Message; description: Message }[]

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const rotationInterval = 8_000
const slideTransition = 800
const snapBackTransition = 240
const dragThreshold = 8
const flickDistance = 24
const flickWindow = 280
const interactiveSelector = 'button, a, input, select, textarea, [role="button"]'

function subscribeToMotionPreference(notify: () => void) {
  motionPreference.addEventListener('change', notify)
  return () => motionPreference.removeEventListener('change', notify)
}

const allowsMotion = () => !motionPreference.matches

type DragState = {
  id: number
  startX: number
  startY: number
  startedAt: number
  horizontal: boolean
}

export function LibraryHero({ packs, reader, open }: {
  packs: readonly PackRevision[]
  reader: boolean
  open: (game: WebGame) => void
}) {
  const t = useT()
  const [{ index, outgoing, direction }, setSlide] = useState({ index: 0, outgoing: null as number | null, direction: 1 })
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const motionAllowed = useSyncExternalStore(subscribeToMotionPreference, allowsMotion)
  const drag = useRef<DragState | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | null>(null)
  const canRotate = motionAllowed && !reader
  const rotating = canRotate && !hovering && !focused && !dragging
  const transitioning = canRotate && outgoing !== null
  const cockatooCover = packs.find(pack => pack.id === 'nonograms-' + starterPack.id)?.data.cover

  function move(step: number) {
    if (step === 0) return
    setSlide(current => ({
      index: (current.index + step + slides.length) % slides.length,
      outgoing: canRotate ? current.index : null,
      direction: Math.sign(step),
    }))
  }

  useEffect(() => {
    if (!rotating) return
    const timer = window.setTimeout(() => move(1), rotationInterval)
    return () => window.clearTimeout(timer)
  }, [index, rotating, canRotate])

  function clearSettleTimer() {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    settleTimer.current = null
  }

  function resetTrack() {
    clearSettleTimer()
    const element = track.current
    if (!element) return
    element.style.transition = ''
    element.style.transform = ''
  }

  function settleTrack(duration: number, easing: 'ease-in-out' | 'ease-out') {
    const element = track.current
    if (!element) return
    clearSettleTimer()
    if (duration === 0) {
      element.style.transition = ''
      element.style.transform = ''
      return
    }
    element.style.transition = `transform ${duration}ms ${easing}`
    element.style.transform = 'translate3d(0, 0, 0)'
    settleTimer.current = window.setTimeout(resetTrack, duration)
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    setFocused(false)
    if (!event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(interactiveSelector)) return
    if (settleTimer.current !== null) resetTrack()
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      horizontal: false,
    }
  }

  function dragMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current
    if (!state || event.pointerId !== state.id) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.horizontal) {
      if (Math.abs(dx) < dragThreshold && Math.abs(dy) < dragThreshold) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null
        return
      }
      state.horizontal = true
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      window.getSelection()?.removeAllRanges()
    }
    event.preventDefault()
    const element = track.current
    if (!element) return
    const limit = Math.min(240, Math.max(64, element.clientWidth * 0.22))
    const offset = limit * Math.tanh(dx / limit)
    element.style.transition = 'none'
    element.style.transform = `translate3d(${offset}px, 0, 0)`
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    const state = drag.current
    if (!state || event.pointerId !== state.id) return
    drag.current = null
    if (!state.horizontal) return
    setDragging(false)
    const width = track.current?.clientWidth ?? 0
    const dx = event.clientX - state.startX
    const threshold = Math.min(90, Math.max(45, width * 0.08))
    const flick = Math.abs(dx) > flickDistance && performance.now() - state.startedAt < flickWindow
    const step = Math.abs(dx) > threshold || flick ? (dx < 0 ? 1 : -1) : 0
    settleTrack(step === 0 ? snapBackTransition : canRotate ? slideTransition : 0,
      step === 0 ? 'ease-out' : 'ease-in-out')
    move(step)
  }

  function cancelDrag(event: PointerEvent<HTMLElement>) {
    const state = drag.current
    if (!state || event.pointerId !== state.id) return
    drag.current = null
    if (!state.horizontal) return
    setDragging(false)
    settleTrack(snapBackTransition, 'ease-out')
  }

  function renderSlide(position: number, active: boolean, leaving = false) {
    const slide = slides[position]
    const game = findGame(slide.game)!
    const cover = slide.game === 'nonograms' && cockatooCover

    return <div key={slide.game} className={'hero-slide hero-' + slide.game} inert={!active}
      aria-hidden={!active || undefined} data-active={active || undefined} data-leaving={leaving || undefined}
      onAnimationEnd={event => {
        if (active && event.target === event.currentTarget) {
          setSlide(current => current.index === position ? { ...current, outgoing: null } : current)
        }
      }}>
      <div className="hero-content">
        <p className="hero-kicker"><span/>{' '}{t(slide.label)}</p>
        <h1>{slide.title}</h1>
        <p>{t(slide.description)}</p>
        <div className="hero-actions">
          <button className="primary hero-action" onClick={() => open(game)}>
            {t('Explore {game}', { game: game.title })}{' '}<ArrowRight size={17}/>
          </button>
        </div>
      </div>
      {cover ? <div className="hero-cover" aria-hidden="true"><img src={cover} alt="" draggable={false}/></div>
        : <div className={'hero-art ' + game.theme} aria-hidden="true">{game.preview(game.sample?.(packs))}</div>}
    </div>
  }

  return <section className={'hero hero-' + slides[index].game} aria-label={t('Featured games')}
    tabIndex={0} data-dragging={dragging || undefined}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovering(true) }}
    onPointerLeave={() => setHovering(false)}
    onFocus={event => setFocused(event.target.matches(':focus-visible'))}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    onPointerDown={startDrag} onPointerMove={dragMove} onPointerUp={finishDrag} onPointerCancel={cancelDrag}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      setFocused(true)
      move(event.key === 'ArrowRight' ? 1 : -1)
    }}>
    <div className="hero-track" id="featured-game" ref={track}
      data-direction={transitioning ? (direction > 0 ? 'forward' : 'backward') : undefined}>
      {/* Keep every slide mounted so the track is sized by the tallest slide. */}
      {slides.map((_, position) => renderSlide(position, position === index, position === outgoing))}
    </div>
    <div className="hero-dots">
      {slides.map((item, position) => <button key={item.game} type="button" className="hero-dot"
        aria-label={t('Show {game}', { game: findGame(item.game)!.title })} aria-controls="featured-game"
        aria-pressed={index === position} onClick={() => { if (position !== index) move(position - index) }}><span/></button>)}
    </div>
  </section>
}
