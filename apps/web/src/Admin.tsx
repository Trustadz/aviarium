import { accountRoles } from '../../../packages/game-sdk/src/roles.js'
import { useIntl } from 'react-intl'
import { knownMessage, useT } from './i18n.js'
import { useEffect, useState } from 'react'
import { Archive, Clock3, Save, Trophy } from 'lucide-react'
import { api, errorMessage, json, type Account } from './api.js'
import { findGame, games } from './registry.js'
import { formatLeaderboardValue, type LeaderboardBoardInfo, type LeaderboardValueUnit } from '../../../packages/game-sdk/src/leaderboards.js'
import { leaderboardBoardTitle } from './Leaderboards.js'
import { ChallengeSettings } from './ChallengeSettings.js'

interface Backup {
  folder: string; schedule: string; retention: number
  last_success?: string; last_attempt?: string; next_run?: string; requested_at?: string; error?: string; archives: string[]
}
interface LeaderboardResult { id: string; playerName: string; game: string; value: number; unit: LeaderboardValueUnit
  completedAt: string; recordedAt: string; status: string; board: LeaderboardBoardInfo }
interface LeaderboardRemoval { id: string; playerName: string; adminName: string; reason: string
  removedAt: string; acknowledgedAt: string | null; value: number; unit: LeaderboardValueUnit; board: LeaderboardBoardInfo }
export default function Admin({ account, openPackStudio }: {account: Account; openPackStudio: (game: string) => void}) {
  const t = useT()
  const { formatDate: format } = useIntl()
  const formatDate = (value?: string) => value ? format(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const [config, setConfig] = useState<Backup>()
  const [form, setForm] = useState({ folder: '', schedule: '0 3 * * *', retention: 3 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaderboardResults, setLeaderboardResults] = useState<LeaderboardResult[]>([])
  const [leaderboardRemovals, setLeaderboardRemovals] = useState<LeaderboardRemoval[]>([])
  const [leaderboardQuery, setLeaderboardQuery] = useState('')
  const [leaderboardStatus, setLeaderboardStatus] = useState('')
  const [leaderboardGame, setLeaderboardGame] = useState('')
  const [leaderboardVisible, setLeaderboardVisible] = useState(20)
  const [removing, setRemoving] = useState<{ id: string; reason: string }>()
  const [tab, setTab] = useState<'backups' | 'users' | 'leaderboards' | 'packs' | 'challenge'>('backups')
  useEffect(() => {
    let active = true
    const fetchBackup = (initial = false) => void api<Backup>('/admin/backup', undefined, account.id).then(value => {
      if (active) { setConfig(value); if (initial) setForm(value) }
    }, error => { if (active) setProblem(errorMessage(error)) })
    fetchBackup(true)
    void api<Account[]>('/admin/users', undefined, account.id).then(value => { if (active) setAccounts(value) },
      error => { if (active) setProblem(errorMessage(error)) })
    const timer = setInterval(fetchBackup, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [account.id])
  function run(task: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }
  function updateAccount(id: string, role: Account['role']) {
    run(async () => {
      const updated = await api<Account>('/admin/users/' + id, json('PATCH', { role }), account.id)
      setAccounts(items => items.map(item => item.id === updated.id ? updated : item))
    })
  }
  function loadLeaderboards() {
    setLeaderboardVisible(20)
    const params = new URLSearchParams()
    if (leaderboardQuery.trim()) params.set('q', leaderboardQuery.trim())
    if (leaderboardStatus) params.set('status', leaderboardStatus)
    if (leaderboardGame) params.set('game', leaderboardGame)
    const encoded = params.toString()
    void api<LeaderboardResult[]>('/admin/leaderboards/results' + (encoded ? '?' + encoded : ''), undefined, account.id)
      .then(value => setLeaderboardResults(value), error => setProblem(errorMessage(error)))
    void api<LeaderboardRemoval[]>('/admin/leaderboards/removals', undefined, account.id)
      .then(value => setLeaderboardRemovals(value), error => setProblem(errorMessage(error)))
  }
  function statusLabel(status: string) {
    return status === 'active' ? t('Active') : status === 'cooldown' ? t('Cooldown') : t('Removed')
  }
  function removeResult() {
    if (!removing?.reason.trim()) return
    run(async () => {
      await api('/admin/leaderboards/results/' + removing.id + '/remove',
        json('POST', { reason: removing.reason.trim() }), account.id)
      setRemoving(undefined)
      setMessage(t('Result removed.'))
      loadLeaderboards()
    })
  }
  useEffect(() => { loadLeaderboards() }, [account.id])
  const visibleLeaderboardResults = leaderboardResults.slice(0, leaderboardVisible)
  return <section className="admin">
    <div className="section-heading"><div><h1>{t("Administration")}</h1><p>{t("Manage Aviarium accounts, content and scheduled database backups.")}</p></div></div>
    {message && <p className="feedback" role="status">{message}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    <div className="admin-tabs" role="tablist" aria-label={t('Administration sections')}>
      {([['backups', t('Backups')], ['users', t('Users')], ['leaderboards', t('Leaderboards')],
        ['packs', t('Packs')], ['challenge', t('Daily Challenge')]] as const).map(([value, label]) =>
        <button key={value} id={'admin-tab-' + value} role="tab" aria-controls={'admin-panel-' + value}
          aria-selected={tab === value} className={tab === value ? 'active' : ''}
          onClick={() => setTab(value)}>{label}</button>)}
    </div>
    <div className="admin-layout">
      {tab === 'backups' && <section className="panel padded" role="tabpanel" id="admin-panel-backups" aria-labelledby="admin-tab-backups"><h2><Archive size={21}/>{" "}{t("Backups")}</h2>
        <form onSubmit={event => { event.preventDefault(); run(async () => {
          await api('/admin/backup', json('PUT', { folder: form.folder, schedule: form.schedule, retention: form.retention }), account.id)
          setMessage(t("Backup settings saved."))
        }) }}>
          <label>{t("Folder within /backup")}<input value={form.folder} maxLength={200} placeholder="/backup"
            onChange={event => setForm({ ...form, folder: event.target.value })}/></label>
          <div className="form-row"><label>{t("Cron schedule (UTC)")}<input required value={form.schedule} onChange={event => setForm({ ...form, schedule: event.target.value })}/></label>
            <label>{t("Archives to keep")}<input type="number" min={1} max={100} required value={form.retention}
              onChange={event => setForm({ ...form, retention: Number(event.target.value) })}/></label></div>
          <div className="button-bar"><button className="primary" type="submit" disabled={busy || !config}><Save size={16}/>{" "}{t("Save settings")}</button>
            <button className="secondary" type="button" disabled={busy || !config || Boolean(config.requested_at)} onClick={() => run(async () => {
              await api('/admin/backup', { method: 'POST' }, account.id); setMessage(t("Backup requested."))
            })}><Clock3 size={16}/>{" "}{t("Run now")}</button></div>
        </form>
        <dl className="status-list">
          <dt>{t("Last success")}</dt><dd>{formatDate(config?.last_success)}</dd>
          <dt>{t("Last attempt")}</dt><dd>{formatDate(config?.last_attempt)}</dd>
          <dt>{t("Next scheduled run")}</dt><dd>{formatDate(config?.next_run)}</dd>
        </dl>
        {config?.error && <p className="error" role="alert">{knownMessage(t, config.error)}</p>}
        <h3>{t("Retained archives")}</h3>
        {config?.archives.length ? <ul className="archive-list">{config.archives.map(name => <li key={name}>{name}</li>)}</ul> : <p>{t("No successful backups yet.")}</p>}
      </section>}
      {tab === 'users' && <section className="panel padded" role="tabpanel" id="admin-panel-users" aria-labelledby="admin-tab-users"><h2>{t("Users")}</h2>
        <p>{t("Users can play every game and manage their settings. Editors can also create and publish puzzles for all games. Admins also manage Aviarium.")}</p>
        {accounts.map(user => <section className="user-permissions" key={user.id} aria-label={user.name}>
          <label className="setting-row"><strong>{user.name}</strong><select aria-label={t('Role for {name}', { name: user.name })}
            disabled={busy || user.id === account.id} value={user.role}
            onChange={event => {
              const role = accountRoles.find(role => role === event.target.value)
              if (role) updateAccount(user.id, role)
            }}>
            <option value="user">{t("User")}</option><option value="editor">{t("Editor")}</option><option value="admin">{t("Admin")}</option>
          </select></label>
        </section>)}
      </section>}
      {tab === 'packs' && <section className="panel padded" role="tabpanel" id="admin-panel-packs" aria-labelledby="admin-tab-packs"><h2>{t("Packs")}</h2>
        {games.map(game => <button key={game.id} className="secondary" onClick={() => openPackStudio(game.id)}>
          {games.length === 1 ? t('Edit as admin') : t('Edit {game} as admin', { game: game.title })}
        </button>)}
      </section>}
      {tab === 'leaderboards' && <section className="panel padded admin-leaderboards" role="tabpanel" id="admin-panel-leaderboards" aria-labelledby="admin-tab-leaderboards">
        <div className="section-heading"><h2><Trophy size={21}/>{" "}{t('Leaderboards')}</h2>
          <span className="badge">{leaderboardResults.length}</span></div>
        <form className="leaderboard-search" onSubmit={event => { event.preventDefault(); loadLeaderboards() }}>
          <label>{t('Player or puzzle')}<input value={leaderboardQuery} maxLength={100}
            onChange={event => setLeaderboardQuery(event.target.value)}/></label>
          <label>{t('Game')}<select value={leaderboardGame} onChange={event => setLeaderboardGame(event.target.value)}>
            <option value="">{t('All games')}</option>
            {games.map(game => <option key={game.id} value={game.id}>{game.title}</option>)}
          </select></label>
          <div className="tabs" role="group" aria-label={t('Status')}>
            {[['', t('All')], ['active', t('Active')], ['cooldown', t('Cooldown')], ['removed', t('Removed')]].map(([value, label]) =>
              <button key={value} type="button" aria-pressed={leaderboardStatus === value}
                onClick={() => setLeaderboardStatus(value)}>{label}</button>)}
          </div>
          <button className="secondary" type="submit" disabled={busy}>{t('Search')}</button>
        </form>
        {leaderboardResults.length === 0 ? <div className="leaderboard-empty">
          <p>{t('No results')}</p>
          <button className="text-button" onClick={() => {
            setLeaderboardQuery(''); setLeaderboardGame(''); setLeaderboardStatus(''); loadLeaderboards()
          }}>{t('Clear filters')}</button>
        </div> : <div className="leaderboard-admin-table">
          <div className="leaderboard-admin-head"><span>{t('Player')}</span><span>{t('Board')}</span>
            <span>{t('Time')}</span><span>{t('Posted')}</span><span>{t('Status')}</span><span/></div>
          {visibleLeaderboardResults.map(result => <div className="leaderboard-admin-row" key={result.id}>
            <div className="leaderboard-admin-player"><strong>{result.playerName}</strong>
              <small>{t('Finished {date}', { date: formatDate(result.completedAt) })}</small></div>
            <div>{leaderboardBoardTitle(t, result.board, findGame(result.game))}</div>
            <div>{formatLeaderboardValue(result.value, result.unit)}</div>
            <div>{formatDate(result.recordedAt)}</div>
            <div><span className="badge">{statusLabel(result.status)}</span></div>
            <div>{result.status !== 'removed' && <button className="secondary danger" disabled={busy}
              onClick={() => setRemoving({ id: result.id, reason: '' })}>{t('Remove')}</button>}</div>
            {removing?.id === result.id && <div className="admin-remove-form">
              <label>{t('Reason')}<input value={removing.reason} maxLength={500} autoFocus
                onChange={event => setRemoving({ id: result.id, reason: event.target.value })}/></label>
              <button className="secondary" disabled={busy || !removing.reason.trim()} onClick={removeResult}>{t('Confirm removal')}</button>
              <button className="text-button" onClick={() => setRemoving(undefined)}>{t('Cancel')}</button>
            </div>}
          </div>)}
        </div>}
        {leaderboardResults.length > 0 && <div className="leaderboard-table-foot">
          <span className="muted">{t('Showing {shown} of {total}', {
            shown: visibleLeaderboardResults.length, total: leaderboardResults.length })}</span>
          {visibleLeaderboardResults.length < leaderboardResults.length &&
            <button className="secondary" onClick={() => setLeaderboardVisible(leaderboardVisible + 20)}>{t('Load more')}</button>}
        </div>}
        <details className="leaderboard-admin-removals">
          <summary>{t('Removed results')} <span className="badge">{leaderboardRemovals.length}</span></summary>
          {leaderboardRemovals.length === 0 ? <p className="muted">{t('No removed results')}</p> : <ul>
            {leaderboardRemovals.map(removal => <li key={removal.id}>
              <div className="admin-result-heading"><strong>{removal.playerName}</strong>
                <span>{leaderboardBoardTitle(t, removal.board, findGame(removal.board.game))}</span>
                <span>{formatLeaderboardValue(removal.value, removal.unit)}</span>
                <span>{formatDate(removal.removedAt)}</span></div>
              <p>{t('Removed by {admin}: {reason}', { admin: removal.adminName, reason: removal.reason })}</p>
              <p className="muted">{removal.acknowledgedAt
                ? t('Acknowledged {date}', { date: formatDate(removal.acknowledgedAt) })
                : t('Not yet acknowledged')}</p>
            </li>)}
          </ul>}
        </details>
      </section>}

      {tab === 'challenge' && <div className="admin-challenge-stack" role="tabpanel" id="admin-panel-challenge" aria-labelledby="admin-tab-challenge"><ChallengeSettings accountId={account.id}/></div>}
    </div>
  </section>
}
