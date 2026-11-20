import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Ellipsis, Trash2 } from 'lucide-react'

export interface ContinueGame {
  id: string
  title: string
  details: string
  progress?: string
  preview: ReactNode
  canResume: boolean
}

interface Props {
  games: readonly ContinueGame[]
  resume: (id: string) => void
  remove: (id: string) => void
}

export function ContinueGames({ games, resume, remove }: Props) {
  const heading = useId()
  const [openOptions, setOpenOptions] = useState<string>()
  const options = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openOptions) return
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !options.current?.contains(event.target)) setOpenOptions(undefined)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [openOptions])

  if (!games.length) return null
  return <section className="continue-games" aria-labelledby={heading}>
    <h2 id={heading}>Continue</h2>
    <ul className="continue-track" aria-labelledby={heading} tabIndex={0}>
      {games.map(game => <li key={game.id} className="continue-card">
        <div className="continue-card-summary">
          <div className="continue-preview" aria-hidden="true">{game.preview}</div>
          <div className="continue-card-info">
            <p>{game.details}</p>
            <h3>{game.title}</h3>
            {game.progress && <p>{game.progress}</p>}
          </div>
        </div>
        <div className="continue-actions">
          <div className="continue-options" ref={openOptions === game.id ? options : undefined}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpenOptions(undefined)
            }}
            onKeyDown={event => {
              if (event.key !== 'Escape' || openOptions !== game.id) return
              event.currentTarget.querySelector('button')?.focus()
              setOpenOptions(undefined)
            }}>
            <button className="icon-button" aria-label={`More options for ${game.title}`} title="Saved game options"
              aria-expanded={openOptions === game.id}
              onClick={() => setOpenOptions(openOptions === game.id ? undefined : game.id)}><Ellipsis size={20}/></button>
            {openOptions === game.id && <div className="continue-options-panel">
              <button className="text-button" onClick={event => {
                event.currentTarget.closest('.continue-options')?.querySelector('button')?.focus()
                setOpenOptions(undefined)
                remove(game.id)
              }}><Trash2 size={15}/> Delete save</button>
            </div>}
          </div>
          <button className="primary" disabled={!game.canResume} onClick={() => resume(game.id)}>Resume <ChevronRight size={17}/></button>
        </div>
      </li>)}
    </ul>
  </section>
}
