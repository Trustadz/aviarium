import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Cloud, Download, FlaskConical, Plus, Save, Sparkles, Upload } from 'lucide-react'
import { difficulties, type Difficulty } from '../../../packages/game-sdk/src/index.js'
import { conflicts, parseGrid } from '../../../packages/sudoku/src/rules.js'
import type { LogicalStep } from '../../../packages/sudoku/src/logic.js'
import { api, errorMessage, json, type Account } from './api.js'
import { Grid } from './Grid.js'
import { downloadFile } from './storage.js'

interface Draft { id: string; title: string; grid: string; version: number }
interface Job {
  id: string; kind: 'validate' | 'generate'; status: string; draftId: string | null; draftVersion: number | null
  result?: { kind?: string; error?: string; reason?: string; grid?: string; solution?: number[]; difficulty?: Difficulty; steps?: LogicalStep[];
    extremeFamilies?: string[] }
}
const blank = '0'.repeat(81)
const statuses: Record<string, string> = { unique: 'Valid · unique solution', multiple: 'Valid · multiple solutions',
  unsolvable: 'Proven unsolvable', invalid: 'Invalid grid', inconclusive: 'Validation incomplete' }

export default function Studio({ account, onPublish }: { account: Account; onPublish: () => void }) {
  const key = 'aviarium:draft:' + account.id
  const [initial] = useState<Partial<Draft>>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') } catch { return {} } })
  const [draft, setDraft] = useState<Draft>()
  const [title, setTitle] = useState(initial.title ?? 'Untitled puzzle')
  const [grid, setGrid] = useState(initial.grid ?? blank)
  const [selected, select] = useState(0)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [generation, setGeneration] = useState<string>()
  const [seed, setSeed] = useState('aviarium-' + new Date().toISOString().slice(0, 10))
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [playback, setPlayback] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [selectedJob, setJob] = useState<string>()

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ title, grid }))
  }, [key, title, grid])
  useEffect(() => {
    let alive = true
    void api<Draft[]>('/drafts', undefined, account.id).then(items => {
      if (alive) {
        setDrafts(items)
        const restored = items.find(item => item.title === initial.title && item.grid === initial.grid)
        if (restored) setDraft(restored)
      }
    }, error => { if (alive) setProblem(errorMessage(error)) })
    const refresh = () => void api<Job[]>('/jobs', undefined, account.id).then(
      items => { if (alive) setJobs(items) },
      error => { if (alive) setProblem(errorMessage(error)) },
    )
    refresh()
    const timer = setInterval(refresh, 1800)
    return () => { alive = false; clearInterval(timer) }
  }, [account.id, initial])

  const exact = draft?.grid === grid && draft?.title === title
  const validateJob = exact ? jobs.find(job => job.kind === 'validate' && job.draftId === draft?.id && job.draftVersion === draft?.version) : undefined
  const shown = jobs.find(job => job.id === selectedJob) ?? validateJob
  const result = validateJob?.result
  const solvable = result?.kind === 'unique' || result?.kind === 'multiple'
  const allowPublish = solvable && Boolean(result?.difficulty)
  const board = Array.from(grid, Number)
  if (playback !== undefined && result?.steps) for (const step of result.steps.slice(0, playback))
    for (const change of step.updates) if (change.filledValue) board[change.index] = change.filledValue

  function doTask(task: () => Promise<void>) {
    if (busy) return
    setBusy(true); setProblem(''); setMessage('')
    void task().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }
  function load(item?: Draft) {
    setDraft(item); setTitle(item?.title ?? 'Untitled puzzle'); setGrid(item?.grid ?? blank)
    setGeneration(undefined); setPlayback(undefined); setJob(undefined); select(0)
  }
  function edit(digit: number) {
    setGrid(grid.slice(0, selected) + digit + grid.slice(selected + 1))
    setGeneration(undefined); setPlayback(undefined); setJob(undefined)
  }
  async function save() {
    if (draft && exact) return draft
    const saved = await api<Draft>(draft ? '/drafts/' + draft.id : '/drafts',
      json(draft ? 'PUT' : 'POST', { title, grid, version: draft?.version, generationJob: generation }), account.id)
    setDraft(saved); setTitle(saved.title)
    setDrafts(items => [saved, ...items.filter(item => item.id !== saved.id)])
    return saved
  }
  async function submit(body: object) {
    const job = await api<Job>('/jobs', json('POST', body), account.id)
    setJobs(items => [job, ...items]); setJob(job.id)
  }
  function importGrid(text: string) {
    let content = text, importedTitle: string | undefined
    if (text.trim().startsWith('{')) {
      const payload = JSON.parse(text)
      if (typeof payload.grid !== 'string') throw new Error('The imported puzzle has no grid.')
      if (payload.ruleset != null && payload.ruleset !== 1) throw new Error('This puzzle needs an unsupported ruleset.')
      content = payload.grid
      importedTitle = typeof payload.title === 'string' ? payload.title.slice(0, 100) : undefined
    }
    const digits = parseGrid(content)
    if (!digits) throw new Error('Import a puzzle with 81 digits. Use 0 or a period for blanks.')
    setDraft(undefined); setGrid(digits.join('')); setTitle(importedTitle || 'Imported puzzle')
    setGeneration(undefined); setPlayback(undefined); setJob(undefined); setMessage('Puzzle imported as a new draft.')
  }

  return <section className="editor">
    <div className="section-heading"><div><div className="eyebrow">SUDOKU</div><h1>Creator studio</h1>
      <p>Build a puzzle and run the checks before publishing it to the shared catalog.</p></div>
      <button className="secondary" onClick={() => load()}><Plus size={17}/> New draft</button></div>
    {problem && <p role="alert" className="error">{problem}</p>}
    {message && <p role="status" className="feedback">{message}</p>}
    <div className="studio-layout">
      <div className="studio-board">
        <label>Draft title<input value={title} maxLength={100} onChange={event => { setTitle(event.target.value); setPlayback(undefined) }}/></label>
        <Grid entries={board} selected={selected} select={select} enter={edit} errors={playback === undefined ? conflicts(board) : undefined}
          disabled={busy || playback !== undefined}/>
        <div className="number-pad">{Array.from({ length: 9 }, (_, index) =>
          <button key={index} disabled={busy || playback !== undefined} onClick={() => edit(index + 1)}>{index + 1}</button>)}</div>
        <div className="button-bar">
          <button className="secondary" disabled={busy || playback !== undefined} onClick={() => edit(0)}>Erase given</button>
          <label className="secondary file-label"><Upload size={16}/> Import<input type="file" accept=".json,.txt,text/plain,application/json" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (file) doTask(async () => { if (file.size > 100_000) throw new Error('Puzzle file is too large.'); importGrid(await file.text()) })
          }}/></label>
          <button className="secondary" onClick={() => downloadFile('sudoku-puzzle.json', JSON.stringify({ title, grid, ruleset: 1 }, null, 2))}><Download size={16}/> Export</button>
        </div>
      </div>
      <div className="studio-side">
        <section className="panel padded"><h2>Drafts</h2>
          <select aria-label="Saved drafts" value={draft?.id ?? ''} onChange={event => load(drafts.find(item => item.id === event.target.value))}>
            <option value="">New draft</option>{drafts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <div className="button-bar">
            <button className="secondary" disabled={busy} onClick={() => doTask(async () => { await save(); setMessage('Draft saved.') })}><Save size={16}/> Save draft</button>
            <button className="primary" disabled={busy} onClick={() => doTask(async () => {
              const saved = await save(); await submit({ kind: 'validate', draftId: saved.id, version: saved.version })
            })}><FlaskConical size={16}/> Test on server</button>
          </div>
          {validateJob && <p className="feedback" role="status">{result?.kind ? statuses[result.kind] : validateJob.status}
            {result?.difficulty ? ' · ' + result.difficulty : solvable ? ' · Needs review' : ''}
            {result?.reason ? ' · ' + result.reason : ''}</p>}
          {Boolean(result?.extremeFamilies?.length) && <p>Extreme techniques · {result?.extremeFamilies?.join(', ')}</p>}
          {allowPublish && <div className="button-bar">
            <button className="secondary" onClick={() => setPlayback(result?.steps?.length ?? 0)}>Show solution</button>
            <button className="secondary" onClick={() => setPlayback(0)}>Step through</button>
            <button className="primary" disabled={busy} onClick={() => doTask(async () => {
              const published = await api<{revision: number}>('/drafts/' + draft!.id + '/publish', json('POST', { jobId: validateJob!.id }), account.id)
              setMessage('Published revision ' + published.revision + ' to the shared catalog.'); onPublish()
            })}><Check size={16}/> Publish</button>
          </div>}
          {playback !== undefined && result?.steps && <div className="playback">
            <button className="icon-button" aria-label="Previous step" disabled={!playback} onClick={() => setPlayback(playback - 1)}><ChevronLeft size={18}/></button>
            <span>{playback} / {result.steps.length}{playback > 0 ? ' · ' + result.steps[playback - 1].label : ''}</span>
            <button className="icon-button" aria-label="Next step" disabled={playback >= result.steps.length} onClick={() => setPlayback(playback + 1)}><ChevronRight size={18}/></button>
            <button className="text-button" onClick={() => setPlayback(undefined)}>Edit grid</button>
          </div>}
        </section>
        <section className="panel padded"><h2>Generate a puzzle</h2>
          <div className="form-row"><label>Seed<input value={seed} maxLength={100} onChange={event => setSeed(event.target.value)}/></label>
            <label>Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value as Difficulty)}>
              {difficulties.map(value => <option key={value}>{value}</option>)}</select></label></div>
          <button className="secondary" disabled={busy || !seed.trim()} onClick={() => doTask(() => submit({ kind: 'generate', options: { seed, difficulty, unique: true } }))}><Sparkles size={16}/> Generate on server</button>
        </section>
        <section className="panel padded"><h2><Cloud size={19}/> Server jobs</h2>
          {jobs.length ? <select aria-label="Server jobs" value={shown?.id ?? ''} onChange={event => setJob(event.target.value)}>
            <option value="">Select job</option>{jobs.map(job => <option value={job.id} key={job.id}>{job.kind} · {job.status} · {job.id.slice(0, 8)}</option>)}</select>
            : <p>No jobs yet.</p>}
          {shown?.result?.error && <p className="error">{shown.result.error}</p>}
          {shown?.kind === 'validate' && shown.result?.kind && shown !== validateJob && <p className="feedback">{statuses[shown.result.kind]}</p>}
          {shown?.kind === 'generate' && shown.result?.grid && <button className="secondary" onClick={() => {
            if (!confirm('Open this generated puzzle as a new draft?')) return
            load(); setGrid(shown.result!.grid!); setTitle('Generated ' + shown.result?.difficulty); setGeneration(shown.id); setJob(shown.id)
          }}>Open generated grid</button>}
        </section>
      </div>
    </div>
  </section>
}
