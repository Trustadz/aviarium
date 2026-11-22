import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

export function StudioDisclosure({ label, className, initiallyOpen = false, children }: {
  label: string
  className?: string
  initiallyOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const content = useId()
  return <div className={className}>
    <button type="button" className="text-button studio-disclosure-trigger" aria-expanded={open} aria-controls={content}
      onClick={() => setOpen(!open)}>
      <ChevronDown size={16} aria-hidden="true"/>{label}
    </button>
    <div id={content} className="studio-disclosure-body" data-open={open} inert={!open} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  </div>
}
