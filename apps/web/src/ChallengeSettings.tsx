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
  eligibleGames: string[] | null
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
  const [gameLimit, setGameLimit] = useState(1)
  const [eligibleGames, setEligibleGames] = useState<string[] | null>(null)
  const [hour, setHour] = useState(0)
  const [minute, setMinute] = useState(0)
  const [profile, setProfile] = useState<Record<string, Record<string, string[]>>>({})
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    void api<ChallengeSettingsData>('/admin/challenges/settings', undefined, accountId).then(value => {
      if (!current) return
      setData(value)
      setEnabled(value.enabled)
      setGameLimit(value.gameLimit)
      setEligibleGames(value.eligibleGames)
      setHour(Math.floor(value.resetMinute / 60))
      setMinute(value.resetMinute % 60)
      setProfile(Object.fromEntries(value.registeredGames.map(game => [game.id,
        Object.fromEntries(game.optionGroups.map(group => [
          group.key, value.gameOptions[game.id]?.[group.key] ?? [...group.defaultEnabled],
        ]))])))
    }, error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId])

  const games = data?.registeredGames ?? []
  const eligible = eligibleGames ?? games.map(game => game.id)
  const eligibleRegistered = games.filter(game => eligible.includes(game.id))
  const valid = eligibleRegistered.length > 0 && gameLimit <= eligibleRegistered.length &&
    eligibleRegistered.every(game => game.optionGroups.every(group =>
      (profile[game.id]?.[group.key]?.length ?? 0) > 0))

  function run(task: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }

  function save() {
    if (!data || !valid) return
    run(async () => {
      const value = await api<ChallengeSettingsData>('/admin/challenges/settings', json('PATCH', {
        enabled,
        gameLimit,
        eligibleGames,
        resetMinute: hour * 60 + minute,
        gameOptions: profile,
        expectedUpdatedAt: data.updatedAt,
      }), accountId)
      setData(value)
      setMessage(t('Challenge settings saved.'))
    })
  }

  function prepare() {
    run(async () => {
      const value = await api<{ prepared: boolean; preparing: boolean }>('/admin/challenges/prepare', json('POST', {}), accountId)
      const refreshed = await api<ChallengeSettingsData>('/admin/challenges/settings', undefined, accountId)
      setData(refreshed)
      setMessage(value.prepared ? t('Challenge prepared.') : t('The challenge could not be prepared. Try again.'))
    })
  }

  function toggleEligible(gameId: string, checked: boolean) {
    const next = checked ? [...new Set([...eligible, gameId])] : eligible.filter(id => id !== gameId)
    setEligibleGames(next.length === games.length ? null : next)
    if (gameLimit > next.length) setGameLimit(Math.max(1, next.length))
  }

  function toggle(gameId: string, groupKey: string, choiceId: string, checked: boolean) {
    setProfile(current => {
      const game = current[gameId] ?? {}
      const selected = game[groupKey] ?? []
      return { ...current, [gameId]: { ...game, [groupKey]: checked
        ? [...new Set([...selected, choiceId])] : selected.filter(id => id !== choiceId) } }
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
        <label>{t('Games per day')}<select value={gameLimit} disabled={busy || games.length < 2}
          onChange={event => setGameLimit(Number(event.target.value))}>
          {Array.from({ length: Math.max(1, eligibleRegistered.length) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select></label>
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
        <label>{t('Timezone')}<input value={data.timezone} readOnly aria-readonly="true"/>
          <small className="muted">{t('Set by the server environment.')}</small></label>
      </div>
      <fieldset className="challenge-settings-options challenge-settings-games">
        <legend>{t('Games in rotation')}</legend>
        {games.map(game => <label key={game.id} className="setting-row">{game.label}
          <input type="checkbox" checked={eligible.includes(game.id)} disabled={busy}
            onChange={event => toggleEligible(game.id, event.target.checked)}/></label>)}
      </fieldset>
      <p className="muted challenge-settings-help">{t('The daily puzzle picks from the enabled values. Disable a value to keep it out of the rotation.')}</p>
      {!valid && <p className="muted" role="status">{t('Enable at least one option for every challenge game.')}</p>}
      {eligibleRegistered.map(game => <section className="challenge-settings-game" key={game.id} aria-label={game.label}>
        <h3>{game.label}</h3>
        {game.optionGroups.map(group => <fieldset className="challenge-settings-options" key={group.key}>
          <legend>{t(group.label as never)}</legend>
          {group.choices.map(choice => <label key={choice.id} className="setting-row">{knownMessage(t, choice.label)}
            <input type="checkbox" checked={(profile[game.id]?.[group.key] ?? []).includes(choice.id)} disabled={busy}
              onChange={event => toggle(game.id, group.key, choice.id, event.target.checked)}/>
          </label>)}
        </fieldset>)}
      </section>)}
      <div className="challenge-settings-status">
        {data.current ? <p><strong>{t('Today')}</strong> · {formatChallengeDate(intl, data.current.startsAt, data.current.timezone)} · {t('Resets at {time} ({zone})', {
          time: formatResetMinute(data.resetMinute), zone: data.timezone })} · {data.current.prepared ? t('Ready') : data.current.preparing ? t('Preparing challenge') : t('Not prepared')}</p>
          : <p><strong>{t('Today')}</strong> · {t('No current challenge')}</p>}
        <p className="muted">{t('Next: {time} ({zone})', { time: formatChallengeTime(t, intl, data.next.startsAt, data.timezone), zone: data.timezone })}</p>
      </div>
      <p className="muted challenge-admin-note">{t('Changes apply from {time} ({zone}).', {
        time: formatChallengeTime(t, intl, data.appliesFrom, data.timezone), zone: data.timezone })}</p>
      <div className="button-bar">
        <button className="primary" onClick={save} disabled={busy || !valid}><Save size={16}/> {t('Save challenge settings')}</button>
        <button className="secondary" onClick={prepare} disabled={busy || !data.enabled}
          title={t('Recovers a missing or failed challenge for the current window.')}><WandSparkles size={16}/> {t('Prepare now')}</button>
      </div>
    </>}
  </section>
}
