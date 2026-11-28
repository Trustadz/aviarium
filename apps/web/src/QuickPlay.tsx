import { ChevronDown } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useT } from './i18n.js'
import './quick-play.css'

export interface QuickPlayChoice {
  key: string
  label: string
  value: string | number
  choices: readonly { value: string | number; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}

export interface QuickPlaySwitch {
  key: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export type QuickPlayOption = QuickPlayChoice | QuickPlaySwitch

function isChoice(option: QuickPlayOption): option is QuickPlayChoice {
  return 'choices' in option
}

export function QuickPlayCard({ title, primary, options, summary, actionLabel, busyLabel, busy, disabled,
  problem, onSubmit, footer }: {
  title?: string
  primary?: QuickPlayChoice
  options?: readonly QuickPlayOption[]
  summary?: string
  actionLabel: string
  busyLabel?: string
  busy?: boolean
  disabled?: boolean
  problem?: ReactNode
  onSubmit: () => void
  footer?: ReactNode
}) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const hasOptions = Boolean(options?.length)
  return <section className="quick-play-card" aria-labelledby={id}>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit() }}>
      <div className="quick-play-card-heading"><h2 id={id}>{title ?? t('Quick Play')}</h2></div>
      <div className={'quick-play-card-main' + (primary ? '' : ' is-single')}>
        {primary && <label className="quick-play-choice">
          <span>{primary.label}</span>
          <select value={primary.value} disabled={primary.disabled || busy}
            onChange={event => primary.onChange(event.target.value)}>
            {primary.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>}
        <button className="primary quick-play-start" type="submit" disabled={disabled || busy}>
          {busy ? busyLabel ?? t('Preparing puzzle…') : actionLabel}
        </button>
      </div>
      {hasOptions && <>
        <button type="button" className="quick-play-options-toggle" aria-expanded={open}
          aria-controls={id + '-options'} onClick={() => setOpen(!open)}>
          <strong>{t('Options')}</strong>
          {summary && <span>{summary}</span>}
          <ChevronDown size={22} aria-hidden="true" className={open ? 'is-open' : undefined}/>
        </button>
        {open && <div className="quick-play-options" id={id + '-options'}>
          {options!.map(option => isChoice(option)
            ? <label className="quick-play-option-select" key={option.key}>
              <span>{option.label}</span>
              <select value={option.value} disabled={option.disabled || busy}
                onChange={event => option.onChange(event.target.value)}>
                {option.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
            : <label className="quick-play-option-switch" key={option.key}>
              <span>{option.label}</span>
              <input type="checkbox" role="switch" checked={option.checked} disabled={busy}
                onChange={event => option.onChange(event.target.checked)}/>
            </label>)}
        </div>}
      </>}
      {problem && <p className="error" role="alert">{problem}</p>}
      {footer}
    </form>
  </section>
}
