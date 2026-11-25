import { RotateCcw } from 'lucide-react'
import type { ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import { useT } from './i18n.js'
import type { Message } from './messages.js'

type Value = boolean | number | null
type Values = Partial<Record<string, Value>>
type Field =
  | { key: string; label: Message; kind: 'switch'; description?: Message }
  | { key: string; label: Message; kind: 'lives'; description: Message }
export interface RuleGroup { label: Message; fields: readonly Field[] }

export function StudioRuleFields({ values, defaults, groups, update }: {
  values: object
  defaults?: ProgressionRules
  groups: readonly RuleGroup[]
  update: (rules: Values) => void
}) {
  const t = useT()
  const chosen = values as Values
  const inherited = defaults as Values | undefined
  const current = { ...inherited, ...chosen }
  function set(key: string, value: Value | undefined, fallback: Value) {
    const next = { ...chosen }
    if (value === undefined || (inherited && value === (inherited[key] ?? fallback))) delete next[key]
    else next[key] = value
    update(next)
  }

  function status(key: string, fallback: Value) {
    return t(chosen[key] === (inherited?.[key] ?? fallback) ? 'Pinned' : 'Changed')
  }

  function reset(key: string, label: string, fallback: Value, showStatus = true) {
    if (!inherited || chosen[key] === undefined) return
    return <span className="studio-rule-changed">{showStatus && status(key, fallback)}
      <button className="icon-button" type="button" aria-label={t('Reset {rule} to chapter default', { rule: label })}
        title={t('Reset {rule} to chapter default', { rule: label })} onClick={event => {
          const row = event.currentTarget.closest('.studio-rule-line')
          set(key, undefined, fallback)
          row?.querySelector<HTMLElement>('input, select')?.focus()
        }}><RotateCcw size={14}/></button>
    </span>
  }

  return <div className="studio-rules">
    {!defaults && <fieldset><legend>{t('Progression')}</legend>
      <label className="studio-rule-choice">{t('Level access')}
        <select aria-label={t('Level access')} value={String(current.inOrder)}
          onChange={event => set('inOrder', event.target.value === 'true', true)}>
          <option value="true">{t('Unlock in order')}</option><option value="false">{t('Play in any order')}</option>
        </select>
      </label>
    </fieldset>}
    {groups.map(group => <fieldset key={group.label}><legend>{t(group.label)}</legend>
      {group.fields.map(field => {
        const { key, description } = field
        const label = t(field.label)
        if (field.kind === 'switch') return <div className="studio-rule-line" key={key}>
          <label className="studio-rule-toggle">
            <span>{label}
              {inherited && chosen[key] !== undefined && <small className="studio-rule-state">{status(key, false)}</small>}
              {description && <small>{t(description)}</small>}
            </span>
            <input className="switch-control" type="checkbox" role="switch" aria-label={label} checked={Boolean(current[key])}
              onChange={event => set(key, event.target.checked, false)}/>
          </label>
          {inherited && <span className="studio-rule-reset-slot">{reset(key, label, false, false)}</span>}
        </div>
        const lives = current[key]
        return <div key={key}>
          <div className="studio-rule-line studio-lives">
            <label className="studio-rule-choice">{label}
              <select aria-label={label} value={lives == null ? 'unlimited' : 'limited'}
                onChange={event => set(key, event.target.value === 'unlimited' ? null : inherited?.[key] ?? 3, null)}>
                <option value="unlimited">{t('Unlimited')}</option><option value="limited">{t('Limited')}</option>
              </select>
            </label>
            {typeof lives === 'number' && <label className="studio-rule-choice">{t('Number of lives')}
              <select aria-label={t('Number of lives')} value={lives} onChange={event => set(key, Number(event.target.value), null)}>
                {Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
              </select>
            </label>}
            {reset(key, label, null)}
          </div>
          {lives != null && <p className="studio-rule-help">{t(field.description)}</p>}
        </div>
      })}
    </fieldset>)}
  </div>
}
