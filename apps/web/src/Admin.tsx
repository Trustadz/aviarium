import { useEffect, useState } from 'react'
import { Archive, Clock3, Save } from 'lucide-react'
import { api, errorMessage, json, type Account } from './api.js'

interface Backup {
  folder: string; schedule: string; retention: number
  last_success?: string; last_attempt?: string; next_run?: string; requested_at?: string; error?: string; archives: string[]
}
interface Publication { id: string; revision: number; title: string; source: string; hidden: boolean }
const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : '—'
export default function Admin({ account, onCatalogChange }: {account: Account; onCatalogChange: () => void}) {
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
  return <section className="admin">
    <div className="section-heading"><div><h1>Administration</h1><p>Manage Aviarium accounts and scheduled database backups.</p></div></div>
    {message && <p className="feedback" role="status">{message}</p>}
    {problem && <p className="error" role="alert">{problem}</p>}
    <div className="admin-layout">
      <section className="panel padded"><h2><Archive size={21}/> Backups</h2>
        <form onSubmit={event => { event.preventDefault(); run(async () => {
          await api('/admin/backup', json('PUT', { folder: form.folder, schedule: form.schedule, retention: form.retention }), account.id)
          setMessage('Backup settings saved.')
        }) }}>
          <label>Folder within /backup<input value={form.folder} maxLength={200} placeholder="/backup"
            onChange={event => setForm({ ...form, folder: event.target.value })}/></label>
          <div className="form-row"><label>Cron schedule (UTC)<input required value={form.schedule} onChange={event => setForm({ ...form, schedule: event.target.value })}/></label>
            <label>Archives to keep<input type="number" min={1} max={100} required value={form.retention}
              onChange={event => setForm({ ...form, retention: Number(event.target.value) })}/></label></div>
          <div className="button-bar"><button className="primary" type="submit" disabled={busy || !config}><Save size={16}/> Save settings</button>
            <button className="secondary" type="button" disabled={busy || !config || Boolean(config.requested_at)} onClick={() => run(async () => {
              await api('/admin/backup', { method: 'POST' }, account.id); setMessage('Backup requested.')
            })}><Clock3 size={16}/> Run now</button></div>
        </form>
        <dl className="status-list">
          <dt>Last success</dt><dd>{formatDate(config?.last_success)}</dd>
          <dt>Last attempt</dt><dd>{formatDate(config?.last_attempt)}</dd>
          <dt>Next scheduled run</dt><dd>{formatDate(config?.next_run)}</dd>
        </dl>
        {config?.error && <p className="error" role="alert">{config.error}</p>}
        <h3>Retained archives</h3>
        {config?.archives.length ? <ul className="archive-list">{config.archives.map(name => <li key={name}>{name}</li>)}</ul> : <p>No successful backups yet.</p>}
      </section>
      <section className="panel padded"><h2>Accounts</h2>
        {accounts.map(user => <label className="setting-row" key={user.id}>{user.name}<select aria-label={'Role for ' + user.name}
          disabled={busy || user.id === account.id} value={user.role} onChange={event => {
            const role = event.target.value
            run(async () => {
              const updated = await api<Account>('/admin/users/' + user.id, json('PATCH', { role }), account.id)
              setAccounts(items => items.map(item => item.id === updated.id ? updated : item))
            })
          }}>{['player', 'creator', 'admin'].map(role => <option key={role}>{role}</option>)}</select></label>)}
      </section>
      <section className="panel padded"><h2>Published puzzles</h2>
        {publications.length === 0 && <p>No creator puzzles published yet.</p>}
        {publications.map(level => <div className="setting-row" key={level.id}>
          <div><strong>{level.title}</strong><p>{level.source} · Revision {level.revision}{level.hidden ? ' · Hidden' : ''}</p></div>
          <button className="secondary" disabled={busy} onClick={() => run(async () => {
            const { hidden } = await api<{hidden: boolean}>('/admin/levels/' + level.id,
              json('PATCH', { hidden: !level.hidden }), account.id)
            setPublications(items => items.map(item => item.id === level.id ? { ...item, hidden } : item))
            onCatalogChange()
          })}>{level.hidden ? 'Show' : 'Hide'}</button>
        </div>)}
      </section>
    </div>
  </section>
}
