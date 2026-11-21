import { useIntl } from 'react-intl'
import { knownMessage, useT } from './i18n.js'
import { useEffect, useState } from 'react'
import { Archive, Clock3, Save } from 'lucide-react'
import { api, errorMessage, json, type Account } from './api.js'
import { games } from './registry.js'

interface Backup {
  folder: string; schedule: string; retention: number
  last_success?: string; last_attempt?: string; next_run?: string; requested_at?: string; error?: string; archives: string[]
}
interface Publication { id: string; revision: number; title: string; source: string; hidden: boolean }
export default function Admin({ account, onCatalogChange }: {account: Account; onCatalogChange: () => void}) {
  const t = useT()
  const { formatDate: format } = useIntl()
  const formatDate = (value?: string) => value ? format(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const [config, setConfig] = useState<Backup>()
  const [form, setForm] = useState({ folder: '', schedule: '0 3 * * *', retention: 3 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [publications, setPublications] = useState<Publication[]>([])
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const fetchBackup = (initial = false) => void api<Backup>('/admin/backup', undefined, account.id).then(value => {
      if (active) { setConfig(value); if (initial) setForm(value) }
    }, error => { if (active) setProblem(errorMessage(error)) })
    fetchBackup(true)
    void api<Account[]>('/admin/users', undefined, account.id).then(value => { if (active) setAccounts(value) },
      error => { if (active) setProblem(errorMessage(error)) })
    void api<Publication[]>('/admin/levels', undefined, account.id).then(value => { if (active) setPublications(value) },
      error => { if (active) setProblem(errorMessage(error)) })
    const timer = setInterval(fetchBackup, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [account.id])
  function run(task: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }
  function updateAccount(id: string, patch: { role: Account['role'] } | { editor: string; enabled: boolean }) {
    run(async () => {
      const updated = await api<Account>('/admin/users/' + id, json('PATCH', patch), account.id)
      setAccounts(items => items.map(item => item.id === updated.id ? updated : item))
    })
  }
  return <section className="admin">
    <div className="section-heading"><div><h1>{t("Administration")}</h1><p>{t("Manage Aviarium accounts and scheduled database backups.")}</p></div></div>
    {message && <p className="feedback" role="status">{message}</p>}
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    <div className="admin-layout">
      <section className="panel padded"><h2><Archive size={21}/>{" "}{t("Backups")}</h2>
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
      </section>
      <section className="panel padded"><h2>{t("Users")}</h2>
        <p>{t("Users can play every game. Editors can create and publish puzzles for the games you assign.")}</p>
        {accounts.map(user => <section className="user-permissions" key={user.id} aria-label={user.name}>
          <label className="setting-row"><strong>{user.name}</strong><select aria-label={t('Role for {name}', { name: user.name })}
            disabled={busy || user.id === account.id} value={user.role}
            onChange={event => updateAccount(user.id, { role: event.target.value as Account['role'] })}>
            <option value="user">{t("User")}</option><option value="admin">{t("Admin")}</option>
          </select></label>
          {games.map(game => <label className="setting-row" key={game.id}>{t('{game} editor', { game: game.title })}
            <input type="checkbox" aria-label={t('{game} editor for {name}', { game: game.title, name: user.name })}
              checked={user.role === 'admin' || user.editorGames.includes(game.id)} disabled={busy || user.role === 'admin'}
              onChange={event => updateAccount(user.id, { editor: game.id, enabled: event.target.checked })}/>
          </label>)}
        </section>)}
      </section>
      <section className="panel padded"><h2>{t("Published puzzles")}</h2>
        {publications.length === 0 && <p>{t("No creator puzzles published yet.")}</p>}
        {publications.map(level => <div className="setting-row" key={level.id}>
          <div><strong>{level.title}</strong><p>{knownMessage(t, level.source)} · {t('Revision {revision}', { revision: level.revision })}{level.hidden ? ' · ' + t('Hidden') : ''}</p></div>
          <button className="secondary" disabled={busy} onClick={() => run(async () => {
            const { hidden } = await api<{hidden: boolean}>('/admin/levels/' + level.id,
              json('PATCH', { hidden: !level.hidden }), account.id)
            setPublications(items => items.map(item => item.id === level.id ? { ...item, hidden } : item))
            onCatalogChange()
          })}>{level.hidden ? t("Show") : t("Hide")}</button>
        </div>)}
      </section>
    </div>
  </section>
}
