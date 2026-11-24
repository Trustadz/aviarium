import { useEffect, useState } from 'react'
import { CalendarDays, Save, WandSparkles } from 'lucide-react'
import { useIntl } from 'react-intl'
import { api, errorMessage, json } from './api.js'
import { knownMessage, useT } from './i18n.js'
import { formatChallengeDate, formatChallengeTime, formatResetMinute } from './Challenges.js'

interface OptionGroup {
  key: string
  label: string
  kind: 'generation' | 'rule'
  choices: { id: string; label: string; value: string | number | boolean | null }[]
  defaultEnabled: string[]
}

interface ChallengeSettingsData {
  enabled: boolean
  gameLimit: number
  resetMinute: number
  timezone: string
  timezoneSource: 'env'
  updatedAt: string
  gameOptions: Record<string, Record<string, string[]>>
  registeredGames: { id: string; label: string; optionGroups: OptionGroup[] }[]
  current: null | { periodKey: string; startsAt: string; endsAt: string; timezone: string; prepared: boolean; preparing: boolean }
  next: { periodKey: string; startsAt: string; endsAt: string; timezone: string }
  appliesFrom: string
  minimumWindowMinutes: number
}

export function ChallengeSettings({ accountId }: { accountId: string }) {
  const t = useT()
  const intl = useIntl()
  const [data, setData] = useState<ChallengeSettingsData>()
  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(0)
  const [minute, setMinute] = useState(0)
  const [profile, setProfile] = useState<Record<string, string[]>>({})
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    void api<ChallengeSettingsData>('/admin/challenges/settings', undefined, accountId).then(value => {
      if (!current) return
      setData(value)
      setEnabled(value.enabled)
      setHour(Math.floor(value.resetMinute / 60))
      setMinute(value.resetMinute % 60)
      const game = value.registeredGames[0]
      const group = game?.optionGroups.find(item => item.kind === 'generation') ?? game?.optionGroups[0]
      setProfile(group ? { [group.key]: value.gameOptions[game!.id]?.[group.key] ?? [...group.defaultEnabled] } : {})
    }, error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId])

  const game = data?.registeredGames[0]
  const group = game?.optionGroups.find(item => item.kind === 'generation') ?? game?.optionGroups[0]
  const selected = group ? (profile[group.key] ?? group.defaultEnabled) : []

  function run(task: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }

  function save() {
    if (!data || !game || !group) return
    run(async () => {
      const value = await api<ChallengeSettingsData>('/admin/challenges/settings', json('PATCH', {
        enabled,
        gameLimit: 1,
        resetMinute: hour * 60 + minute,
        gameOptions: { [game.id]: { [group.key]: selected } },
        expectedUpdatedAt: data.updatedAt,
      }), accountId)
      setData(value)
      setMessage(t('Challenge settings saved.'))
    })
  }

  function prepare() {
    run(async () => {
      const value = await api<{ prepared: boolean; preparing: boolean; occurrence?: { periodKey: string } }>(
        '/admin/challenges/prepare', json('POST', {}), accountId)
      setMessage(value.prepared ? t('Challenge prepared.') : t('The challenge could not be prepared. Try again.'))
    })
  }

  return <section className="panel padded admin-challenges">
    <div className="section-heading"><div><h2><CalendarDays size={21}/> {t('Challenge settings')}</h2>
      <p>{t('Set the daily reset and the generation options. Challenge content is generated, never authored here.')}</p></div></div>
    {!data && !problem && <p role="status">{t('Loading…')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {data && <>
      <label className="setting-row">{t('Enable daily challenges')}<input type="checkbox" checked={enabled}
        disabled={busy} onChange={event => setEnabled(event.target.checked)}/></label>
      <div className="form-row">
        <label>{t('Reset time')}
          <span className="challenge-time-selects">
            <select aria-label={t('Reset hour')} value={hour} disabled={busy} onChange={event => setHour(Number(event.target.value))}>
              {Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, '0')}</option>)}
            </select>
            <span aria-hidden="true">:</span>
            <select aria-label={t('Reset minute')} value={minute} disabled={busy} onChange={event => setMinute(Number(event.target.value))}>
              {Array.from({ length: 60 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, '0')}</option>)}
            </select>
          </span>
        </label>
        <label>{t('Timezone')}<input value={data.timezone} readOnly aria-readonly="true"/></label>
      </div>
      {group && <fieldset className="challenge-settings-options"><legend>{t('Generation options')}</legend>
        <p className="muted">{t('The daily puzzle picks from the enabled values. Disable a value to keep it out of the rotation.')}</p>
        {group.choices.map(choice => <label key={choice.id} className="setting-row">{t(choice.label as never)}
          <input type="checkbox" checked={selected.includes(choice.id)} disabled={busy} onChange={event => {
            const next = event.target.checked ? [...selected, choice.id] : selected.filter(id => id !== choice.id)
            setProfile(current => ({ ...current, [group.key]: next }))
          }}/></label>)}
      </fieldset>}
      <div className="challenge-settings-status">
        {data.current ? <p><strong>{t('Today')}</strong> · {formatChallengeDate(intl, data.current.startsAt, data.current.timezone)} · {t('Resets at {time} ({zone})', {
          time: formatResetMinute(data.resetMinute), zone: data.timezone })} · {data.current.prepared ? t('Ready') : data.current.preparing ? t('Preparing challenge') : t('Not prepared')}</p>
          : <p><strong>{t('Today')}</strong> · {t('No current challenge')}</p>}
        <p className="muted">{t('Next: {time} ({zone})', { time: formatChallengeTime(t, intl, data.next.startsAt, data.timezone), zone: data.timezone })}</p>
      </div>
      <div className="button-bar">
        <button className="primary" onClick={save} disabled={busy || !selected.length}><Save size={16}/> {t('Save challenge settings')}</button>
        <button className="secondary" onClick={prepare} disabled={busy || !data.enabled}><WandSparkles size={16}/> {t('Prepare now')}</button>
      </div>
    </>}
  </section>
}
