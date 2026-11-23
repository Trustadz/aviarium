import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function PackWorkspace({ title, context, navigation, actions, sections, active, choose, sidebar, children }: {
  title: string
  context?: ReactNode
  navigation: ReactNode
  actions: ReactNode
  sections: readonly { id: string; title: string }[]
  active: string
  choose: (id: string) => void
  sidebar?: ReactNode
  children: ReactNode
}) {
  const tabs = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const list = tabs.current
    if (!list) return
    function measure() {
      const selected = list?.querySelector<HTMLElement>('[aria-pressed=true]')
      if (!list || !selected) { list?.style.setProperty('--indicator-opacity', '0'); return }
      list.style.setProperty('--indicator-x', selected.offsetLeft + 'px')
      list.style.setProperty('--indicator-width', selected.offsetWidth + 'px')
      list.style.setProperty('--indicator-opacity', '1')
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(list)
    for (const button of list.querySelectorAll('button')) resize.observe(button)
    return () => resize.disconnect()
  }, [active])

  return <section className="pack-workspace" onFocusCapture={event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest('dialog') || !matchMedia('(max-width: 899px)').matches) return
    requestAnimationFrame(() => {
      if (document.activeElement !== target) return
      const rail = document.querySelector('.app-rail')?.getBoundingClientRect()
      if (!rail) return
      const overlap = target.getBoundingClientRect().bottom - rail.top + 8
      if (overlap > 0) window.scrollBy({ top: overlap, behavior: 'instant' })
    })
  }}>
    <header className="pack-workspace-header">
      <div>{navigation}<h1>{title}</h1>{context}</div>
      <div className="button-bar">{actions}</div>
    </header>
    <nav className="tabs studio-workspace-tabs" ref={tabs} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll('button')]
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      if (index < 0) return
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1
      if (target < 0) return
      event.preventDefault()
      buttons[target].focus()
      choose(sections[target].id)
    }}>
      {sections.map(section => <button key={section.id} aria-pressed={section.id === active}
        onClick={() => choose(section.id)}>{section.title}</button>)}
      <span className="studio-tab-indicator" aria-hidden="true"/>
    </nav>
    <div className={sidebar ? 'pack-workspace-grid' : undefined}>
      {sidebar && <aside className="panel padded pack-workspace-sidebar">{sidebar}</aside>}
      <div className="pack-workspace-content">{children}</div>
    </div>
  </section>
}
