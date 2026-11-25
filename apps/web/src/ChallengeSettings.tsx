import { useEffect, useState } from 'react'
import { CalendarDays, Plus, Save, Trash2, WandSparkles } from 'lucide-react'
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

interface RegisteredGame {
  id: string
  label: string
  optionGroups: OptionGroup[]
}

interface GameSelection {
  game: string
  options: Record<string, string[]>
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
  gameSelections: GameSelection[]
  registeredGames: RegisteredGame[]
  current: null | { periodKey: string; startsAt: string; endsAt: string; timezone: string; prepared: boolean; preparing: boolean }
  next: { periodKey: string; startsAt: string; endsAt: string; timezone: string }
  appliesFrom: string
  minimumWindowMinutes: number
}

function defaultsFor(game: RegisteredGame): Record<string, string[]> {
  return Object.fromEntries(game.optionGroups.map(group => [
    group.key, group.defaultEnabled.map(String),
  ]))
}

function normalizeSelection(selection: GameSelection, game: RegisteredGame | undefined): GameSelection {
  if (!game) return { game: selection.game, options: {} }
  const defaults = defaultsFor(game)
  return {
    game: game.id,
    options: Object.fromEntries(game.optionGroups.map(group => [
      group.key, (selection.options[group.key] ?? defaults[group.key] ?? []).map(String),
    ])),
  }
}

function selectionsFromData(data: ChallengeSettingsData): GameSelection[] {
  const games = new Map(data.registeredGames.map(game => [game.id, game]))
  const raw = data.gameSelections?.length ? data.gameSelections : (() => {
    const ids = data.eligibleGames ?? data.registeredGames.map(game => game.id)
    return ids.map(game => ({ game, options: data.gameOptions?.[game] ?? {} }))
  })()
  return raw.map(selection => normalizeSelection(selection, games.get(selection.game)))
}

export function ChallengeSettings({ accountId }: { accountId: string }) {
  const t = useT()
  const intl = useIntl()
  const [data, setData] = useState<ChallengeSettingsData>()
  const [enabled, setEnabled] = useState(false)
  const [gameLimit, setGameLimit] = useState(1)
  const [selections, setSelections] = useState<GameSelection[]>([])
  const [hour, setHour] = useState(0)
  const [minute, setMinute] = useState(0)
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    void api<ChallengeSettingsData>('/admin/challenges/settings', undefined, accountId).then(value => {
      if (!current) return
      const loaded = selectionsFromData(value)
      setData(value)
      setEnabled(value.enabled)
      setGameLimit(Math.max(1, Math.min(value.gameLimit, new Set(loaded.map(item => item.game)).size || 1)))
      setSelections(loaded)
      setHour(Math.floor(value.resetMinute / 60))
      setMinute(value.resetMinute % 60)
    }, error => { if (current) setProblem(errorMessage(error)) })
    return () => { current = false }
  }, [accountId])

  const games = data?.registeredGames ?? []
  const gameById = new Map(games.map(game => [game.id, game]))
  const distinctGames = [...new Set(selections.map(selection => selection.game))]
  const gameLimitMax = Math.max(1, distinctGames.length)
  const valid = selections.length > 0 && gameLimit <= distinctGames.length &&
    selections.every(selection => {
      const game = gameById.get(selection.game)
      return Boolean(game) && game!.optionGroups.every(group => (selection.options[group.key]?.length ?? 0) > 0)
    })

  function run(task: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }

  function refresh(value: ChallengeSettingsData) {
    setData(value)
    setEnabled(value.enabled)
    setGameLimit(Math.max(1, Math.min(value.gameLimit, new Set(value.gameSelections.map(item => item.game)).size || 1)))
    setSelections(selectionsFromData(value))
    setHour(Math.floor(value.resetMinute / 60))
    setMinute(value.resetMinute % 60)
  }

  function save() {
    if (!data || !valid) return
    run(async () => {
      const value = await api<ChallengeSettingsData>('/admin/challenges/settings', json('PATCH', {
        enabled,
        gameLimit,
        resetMinute: hour * 60 + minute,
        gameSelections: selections.map(selection => ({ game: selection.game, options: selection.options })),
        expectedUpdatedAt: data.updatedAt,
      }), accountId)
      refresh(value)
      setMessage(t('Challenge settings saved.'))
    })
  }

  function prepare() {
    run(async () => {
      const value = await api<{ prepared: boolean; preparing: boolean }>('/admin/challenges/prepare', json('POST', {}), accountId)
      const refreshed = await api<ChallengeSettingsData>('/admin/challenges/settings', undefined, accountId)
      refresh(refreshed)
      setMessage(value.prepared ? t('Challenge prepared.') : t('The challenge could not be prepared. Try again.'))
    })
  }

  function addSelection() {
    const game = games[0]
    if (!game) return
    setSelections(current => [...current, { game: game.id, options: defaultsFor(game) }])
  }

  function removeSelection(index: number) {
    setSelections(current => current.filter((_, item) => item !== index))
  }

  function changeGame(index: number, gameId: string) {
    const game = gameById.get(gameId)
    if (!game) return
    setSelections(current => current.map((selection, item) => item === index
      ? { game: gameId, options: defaultsFor(game) } : selection))
  }

  function toggle(index: number, groupKey: string, choiceId: string, checked: boolean) {
    setSelections(current => current.map((selection, item) => {
      if (item !== index) return selection
      const selected = selection.options[groupKey] ?? []
      return { ...selection, options: { ...selection.options, [groupKey]: checked
        ? [...new Set([...selected, choiceId])] : selected.filter(id => id !== choiceId) } }
    }))
  }

  return <section className="panel padded admin-challenges">
    <div className="section-heading"><div><h2><CalendarDays size={21}/> {t('Challenge settings')}</h2>
      <p>{t('Set the daily reset and the game selections. Challenge content is generated, never authored here.')}</p></div></div>
    {!data && !problem && <p role="status">{t('Loading…')}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {data && <>
      <label className="setting-row challenge-global-toggle">{t('Enable daily challenges')}<input type="checkbox" checked={enabled}
        disabled={busy} onChange={event => setEnabled(event.target.checked)}/></label>
      <div className="form-row">
        <label>{t('Games per day')}<select value={gameLimit} disabled={busy || gameLimitMax < 2}
          onChange={event => setGameLimit(Number(event.target.value))}>
          {Array.from({ length: gameLimitMax }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
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
        <div className="challenge-static-setting"><span>{t('Timezone')}</span><strong>{data.timezone}</strong>
          <small className="muted">{t('Set by the server environment.')}</small></div>
      </div>
      <fieldset className="challenge-settings-options challenge-selections">
        <legend>{t('Game selections')}</legend>
        <p className="muted challenge-selections-help">{t('Each row is a possible daily game. Add a game more than once to offer different option sets; a game is still used at most once per day.')}</p>
        {selections.map((selection, index) => {
          const game = gameById.get(selection.game)
          return <section className="challenge-selection" key={index} aria-label={t('Game selection {position}', { position: index + 1 })}>
            <div className="challenge-selection-head">
              <label>{t('Game')}<select value={selection.game} disabled={busy}
                onChange={event => changeGame(index, event.target.value)}>
                {games.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select></label>
              <button className="text-button danger" type="button" disabled={busy} onClick={() => removeSelection(index)}>
                <Trash2 size={16}/> {t('Remove')}
              </button>
            </div>
            {game?.optionGroups.map(group => <fieldset className="challenge-settings-options" key={group.key}>
              <legend>{t(group.label as never)}</legend>
              {group.choices.map(choice => <label key={choice.id} className="setting-row">{knownMessage(t, choice.label)}
                <input type="checkbox" checked={(selection.options[group.key] ?? []).includes(choice.id)} disabled={busy}
                  onChange={event => toggle(index, group.key, choice.id, event.target.checked)}/>
              </label>)}
            </fieldset>)}
          </section>
        })}
        <button className="secondary" type="button" disabled={busy || !games.length} onClick={addSelection}>
          <Plus size={16}/> {t('Add game selection')}
        </button>
      </fieldset>
      {!selections.length && <p className="muted" role="status">{t('Add at least one game selection.')}</p>}
      {selections.length > 0 && !valid && <p className="muted" role="status">{t('Enable at least one option for every selected game.')}</p>}
      <div className="challenge-settings-status">
        {data.current ? <p><strong>{t('Today')}</strong> · {formatChallengeDate(intl, data.current.startsAt, data.current.timezone)} · {t('Resets at {time} ({zone})', {
          time: formatResetMinute(data.resetMinute), zone: data.timezone })} · {data.current.prepared ? t('Ready') : data.current.preparing ? t('Preparing challenge') : t('Not prepared')}</p>
          : <p><strong>{t('Today')}</strong> · {t('No current challenge')}</p>}
        <p className="muted">{t('Next: {date} at {time} ({zone})', {
          date: formatChallengeDate(intl, data.next.startsAt, data.timezone),
          time: formatChallengeTime(t, intl, data.next.startsAt, data.timezone), zone: data.timezone })}</p>
      </div>
      <p className="muted challenge-admin-note">{t('Changes apply from {date} at {time} ({zone}).', {
        date: formatChallengeDate(intl, data.appliesFrom, data.timezone),
        time: formatChallengeTime(t, intl, data.appliesFrom, data.timezone), zone: data.timezone })}</p>
      <div className="button-bar">
        <button className="primary" onClick={save} disabled={busy || !valid}><Save size={16}/> {t('Save challenge settings')}</button>
        <button className="secondary" onClick={prepare} disabled={busy || !data.enabled}
          title={t('Recovers a missing or failed challenge for the current window.')}><WandSparkles size={16}/> {t('Prepare now')}</button>
      </div>
    </>}
  </section>
}
