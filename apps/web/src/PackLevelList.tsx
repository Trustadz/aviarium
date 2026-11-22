import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { useT } from './i18n.js'

interface LevelRow { id: string; title: string; detail: string }

export function PackLevelList({ levels, selected, disabled, canInsert, select, move, insert, remove }: {
  levels: LevelRow[]; selected?: string; disabled: boolean; canInsert: boolean
  select: (id: string) => void; move: (from: number, to: number) => void
  insert: (after: number) => void; remove: (id: string) => void
}) {
  const t = useT()
  const list = useRef<HTMLOListElement>(null)
  const active = useRef<{ index: number; target: number; origin: number; y: number; started: boolean; midpoints: number[]; height: number }>(null)
  const scrollFrame = useRef(0)
  const previousPositions = useRef<Map<HTMLElement, number>>(new Map())
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])
  const [drag, setDrag] = useState<{ index: number; target: number; height: number }>()
  const [menu, setMenu] = useState<string>()
  const [announcement, setAnnouncement] = useState('')

  function capturePositions() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('.pack-level-row:not(.is-dragging)') ?? [])]
    previousPositions.current = new Map(rows.map(row => [row, row.getBoundingClientRect().top]))
  }

  useLayoutEffect(() => {
    for (const [row, previous] of previousPositions.current) {
      if (!row.isConnected || row.classList.contains('is-dragging')) continue
      row.getAnimations().filter(animation => animation.id === 'studio-reorder').forEach(animation => animation.cancel())
      const offset = previous - row.getBoundingClientRect().top
      if (Math.abs(offset) > 1) {
        row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
          { duration: 240, easing: 'cubic-bezier(.2,.75,.3,1)', id: 'studio-reorder' })
      }
    }
    previousPositions.current.clear()
  }, [levels, drag])

  function reorder(from: number, to: number) {
    if (disabled || from === to || to < 0 || to >= levels.length) return
    capturePositions()
    move(from, to)
    requestAnimationFrame(() => {
      list.current?.querySelectorAll<HTMLButtonElement>('.pack-level-grip')[to]?.focus({ preventScroll: true })
    })
    setAnnouncement(t('Moved {title} to {position} of {total}', {
      title: levels[from].title, position: to + 1, total: levels.length,
    }))
  }

  function updateDropTarget() {
    const item = active.current
    if (!list.current || !item?.started) return
    const bounds = list.current.getBoundingClientRect()
    if (item.y < bounds.top + 26) list.current.scrollBy(0, -8)
    if (item.y > bounds.bottom - 26) list.current.scrollBy(0, 8)
    const position = item.y - bounds.top + list.current.scrollTop
    const next = item.midpoints.findIndex(midpoint => position < midpoint)
    const slot = next < 0 ? item.midpoints.length : next
    const target = slot > item.index ? slot - 1 : slot
    if (item.target !== target) {
      capturePositions()
      item.target = target
      setDrag({ index: item.index, target, height: item.height })
    }
    scrollFrame.current = requestAnimationFrame(updateDropTarget)
  }

  function track(event: PointerEvent<HTMLButtonElement>) {
    const item = active.current
    if (!item) return
    item.y = event.clientY
    if (!item.started && Math.abs(item.origin - item.y) >= 5) {
      item.started = true
      capturePositions()
      setDrag({ index: item.index, target: item.target, height: item.height })
      updateDropTarget()
    }
  }

  function finish(commit: boolean) {
    cancelAnimationFrame(scrollFrame.current)
    if (commit) updateDropTarget()
    const item = active.current
    active.current = null
    cancelAnimationFrame(scrollFrame.current)
    capturePositions()
    setDrag(undefined)
    if (commit && item?.started) reorder(item.index, item.target)
  }

  const ghost = drag && <li className="pack-level-ghost" style={{ height: drag.height }} aria-hidden="true">
    <GripVertical size={16}/>
    <span className="pack-level-copy"><strong>{levels[drag.index]?.title}</strong><small>{levels[drag.index]?.detail}</small></span>
  </li>
  return <>
    <ol className="studio-level-list" ref={list}>
      {levels.map((level, index) => {
        const isOpen = menu === level.id
        return <Fragment key={level.id}>
          {drag?.target === index && drag.index >= index && ghost}
          <li className={'pack-level-row' + (selected === level.id ? ' is-selected' : '') +
            (drag?.index === index ? ' is-dragging' : '')}>
          <div className="pack-level-row-main">
            <button type="button" className="icon-button pack-level-grip" disabled={disabled || levels.length < 2}
              aria-label={t('Reorder {title}', { title: level.title })} aria-description={t('Drag to reorder, or press Up or Down')} title={t('Drag to reorder, or press Up or Down')}
              onPointerDown={event => {
                const listElement = list.current
                if (event.button !== 0 || !event.isPrimary || !listElement) return
                const bounds = listElement.getBoundingClientRect()
                const rows = [...listElement.querySelectorAll<HTMLElement>('.pack-level-row')]
                const rowBoxes = rows.map(row => row.querySelector('.pack-level-row-main')!.getBoundingClientRect())
                const midpoints = rowBoxes.map(row => row.top + row.height / 2 - bounds.top + listElement.scrollTop)
                setMenu(undefined)
                active.current = { index, target: index, origin: event.clientY, y: event.clientY, started: false,
                  midpoints, height: Math.max(42, rowBoxes[index].height + 2) }
                event.currentTarget.setPointerCapture(event.pointerId)
              }} onPointerMove={track} onPointerUp={() => finish(true)}
              onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
              onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1))
              }}><GripVertical size={16}/></button>
            <button type="button" className="pack-level-select" aria-pressed={selected === level.id}
              onClick={() => { setMenu(undefined); select(level.id) }}>
              <span className="studio-level-order">{index + 1}</span>
              <span className="pack-level-copy"><strong title={level.title}>{level.title}</strong><small>{level.detail}</small></span>
            </button>
            <button type="button" className="icon-button pack-level-adjacent" disabled={disabled || index === 0}
              aria-label={t('Move {title} up', { title: level.title })} title={t('Move up')}
              onClick={() => reorder(index, index - 1)}><ArrowUp size={16}/></button>
            <button type="button" className="icon-button pack-level-adjacent" disabled={disabled || index === levels.length - 1}
              aria-label={t('Move {title} down', { title: level.title })} title={t('Move down')}
              onClick={() => reorder(index, index + 1)}><ArrowDown size={16}/></button>
            <button type="button" className="icon-button" disabled={disabled} aria-expanded={isOpen}
              aria-label={t('Actions for {title}', { title: level.title })}
              onClick={() => setMenu(isOpen ? undefined : level.id)}><MoreHorizontal size={17}/></button>
          </div>
          <div className={'pack-level-menu' + (isOpen ? ' is-open' : '')} inert={!isOpen} aria-hidden={!isOpen} onKeyDown={event => {
            if (event.key === 'Escape') {
              setMenu(undefined)
              event.currentTarget.previousElementSibling?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
            }
          }}>
          <div className="pack-level-actions">
            <button type="button" className="text-button pack-level-menu-move" disabled={disabled || index === 0}
              onClick={() => { setMenu(undefined); reorder(index, index - 1) }}><ArrowUp size={15}/> {t('Move up')}</button>
            <button type="button" className="text-button pack-level-menu-move" disabled={disabled || index === levels.length - 1}
              onClick={() => { setMenu(undefined); reorder(index, index + 1) }}><ArrowDown size={15}/> {t('Move down')}</button>
            <button type="button" className="text-button" disabled={disabled || !canInsert} onClick={() => { setMenu(undefined); insert(index) }}>
              <Plus size={15}/> {t('Insert level after this one')}
            </button>
            <button type="button" className="text-button" disabled={disabled} onClick={() => { setMenu(undefined); remove(level.id) }}>
              <Trash2 size={15}/> {t('Remove level')}
            </button>
          </div>
          </div>
          </li>
          {drag?.target === index && drag.index < index && ghost}
        </Fragment>
      })}
    </ol>
    <span className="sr-only" role="status">{announcement}</span>
  </>
}
