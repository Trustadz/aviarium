import { useLayoutEffect, useRef } from 'react'
import { Check, LockKeyhole, Timer } from 'lucide-react'

export interface PackTrailStop {
  id: string
  title: string
  detail?: string
  state: 'available' | 'next' | 'solved' | 'locked'
  statusLabel?: string
  introduction?: string
  challenge?: string
  actionLabel: string
  actionName: string
  bestTime?: string
  play: () => void
}

export function PackTrail({ stops, canPlay, scrollToStop = true }: {
  stops: readonly PackTrailStop[]
  canPlay: boolean
  scrollToStop?: boolean
}) {
  const trail = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const list = trail.current
    if (!list || !scrollToStop) return
    const anchor = location.hash.slice(1)
    const linked = /^stop-\d+$/.test(anchor) ? list.querySelector('#' + anchor) : null
    const stop = linked ?? list.querySelector('[aria-current="step"]') ?? list.lastElementChild
    // Keep the title and chapter line in view when the trail already fits;
    // only scroll the minimum needed to reveal the current stop.
    stop?.scrollIntoView({ block: 'nearest' })
  }, [scrollToStop])

  return <ol className="pack-trail" ref={trail} role="list">
    {stops.map((stop, index) => <li id={`stop-${index + 1}`} key={stop.id} data-state={stop.state}
      aria-current={stop.state === 'next' ? 'step' : undefined}>
      <span className="pack-stop-marker" aria-hidden="true">
        {stop.state === 'solved' ? <Check size={23}/> : stop.state === 'locked' ? <LockKeyhole size={19}/> : index + 1}
      </span>
      <div className="pack-stop-card">
        <h2>{stop.title}</h2>
        {stop.introduction && <p>{stop.introduction}</p>}
        {stop.detail && <p>{stop.detail}</p>}
        {stop.challenge && <p>{stop.challenge}</p>}
        {stop.statusLabel && <p className="pack-stop-status">{stop.statusLabel}</p>}
        {stop.bestTime && <p className="pack-best"><Timer size={14} aria-hidden="true"/> {stop.bestTime}</p>}
        {stop.state !== 'locked' && <button className={stop.state === 'next' ? 'primary' : 'secondary'}
          disabled={!canPlay} onClick={stop.play} aria-label={stop.actionName}>
          {stop.actionLabel}
        </button>}
      </div>
    </li>)}
  </ol>
}
