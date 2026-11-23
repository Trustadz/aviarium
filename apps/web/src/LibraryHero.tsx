import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
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

function subscribeToMotionPreference(notify: () => void) {
  motionPreference.addEventListener('change', notify)
  return () => motionPreference.removeEventListener('change', notify)
}

const allowsMotion = () => !motionPreference.matches

export function LibraryHero({ catalog, packs, reader, open }: {
  catalog: readonly GameLevel[]
  packs: readonly PackRevision[]
  reader: boolean
  open: (game: WebGame) => void
}) {
  const t = useT()
  const [{ index, outgoing, direction }, setSlide] = useState({ index: 0, outgoing: null as number | null, direction: 1 })
  const [paused, setPaused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const motionAllowed = useSyncExternalStore(subscribeToMotionPreference, allowsMotion)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const canRotate = motionAllowed && !reader
  const rotating = canRotate && !paused && !hovering && !focused
  const transitioning = canRotate && outgoing !== null
  const cockatooCover = packs.find(pack => pack.id === 'nonograms-' + starterPack.id)?.data.cover

  function move(direction: number) {
    setSlide(current => ({
      index: (current.index + direction + slides.length) % slides.length,
      outgoing: canRotate ? current.index : null,
      direction,
    }))
  }

  useEffect(() => {
    if (!rotating) return
    const timer = window.setTimeout(() => move(1), rotationInterval)
    return () => window.clearTimeout(timer)
  }, [index, rotating, canRotate])

  function startSwipe(event: PointerEvent<HTMLElement>) {
    setFocused(false)
    if (event.pointerType === 'touch' && event.isPrimary && !(event.target as HTMLElement).closest('button')) {
      swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
  }

  function finishSwipe(event: PointerEvent<HTMLElement>) {
    const start = swipe.current
    if (!start || event.pointerId !== start.id) return
    swipe.current = null
    const x = event.clientX - start.x
    const y = event.clientY - start.y
    if (Math.abs(x) > Math.max(45, Math.abs(y) * 1.4)) move(x < 0 ? 1 : -1)
  }

  function renderSlide(position: number, leaving = false) {
    const slide = slides[position]
    const game = findGame(slide.game)!
    const cover = slide.game === 'nonograms' && cockatooCover

    return <div key={slide.game} className={'hero-slide hero-' + slide.game} inert={leaving}
      aria-hidden={leaving || undefined} data-leaving={leaving || undefined}
      onAnimationEnd={event => {
        if (!leaving && event.target === event.currentTarget) {
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
      {cover ? <div className="hero-cover" aria-hidden="true"><img src={cover} alt=""/></div>
        : <div className={'hero-art ' + game.theme} aria-hidden="true">{game.preview(game.sample?.(catalog))}</div>}
    </div>
  }

  return <section className={'hero hero-' + slides[index].game} aria-label={t('Featured games')}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovering(true) }}
    onPointerLeave={() => setHovering(false)}
    onFocus={event => setFocused(event.target.matches(':focus-visible'))}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    onPointerDown={startSwipe} onPointerUp={finishSwipe} onPointerCancel={() => { swipe.current = null }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      setFocused(true)
      move(event.key === 'ArrowRight' ? 1 : -1)
    }}>
    <div className="hero-track" id="featured-game"
      data-direction={transitioning ? (direction > 0 ? 'forward' : 'backward') : undefined}>
      {transitioning && renderSlide(outgoing, true)}
      {renderSlide(index)}
    </div>
    <div className="hero-controls">
      {canRotate && <button type="button" aria-label={t(paused ? 'Resume featured games' : 'Pause featured games')}
        aria-controls="featured-game" onClick={() => setPaused(current => !current)}>
        {paused ? <Play size={15}/> : <Pause size={15}/>}
      </button>}
      <button type="button" aria-label={t('Previous featured game')} aria-controls="featured-game" onClick={() => move(-1)}>
        <ArrowLeft size={18}/>
      </button>
      {slides.map((item, position) => <button key={item.game} type="button" className="hero-dot"
        aria-label={t('Show {game}', { game: findGame(item.game)!.title })} aria-controls="featured-game"
        aria-pressed={index === position} onClick={() => { if (position !== index) move(position - index) }}><span/></button>)}
      <button type="button" aria-label={t('Next featured game')} aria-controls="featured-game" onClick={() => move(1)}>
        <ArrowRight size={18}/>
      </button>
      <div className="hero-timer">
        <span>{t(rotating ? 'Next slide' : canRotate ? 'Carousel paused' : 'Auto-advance off')}</span>
        <div className="hero-timer-track" aria-hidden="true">
          {rotating && <div key={index} className="hero-timer-fill" style={{ animationDuration: `${rotationInterval}ms` }}/>}
        </div>
      </div>
    </div>
  </section>
}
