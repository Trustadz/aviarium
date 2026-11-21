import { levelTitle } from './sudoku-copy.js'
import { knownMessage, useT } from './i18n.js'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Save, Trash2, Upload } from 'lucide-react'
import type { PublishedLevel } from '../../../packages/game-sdk/src/index.js'
import { packImageBytes, packUploadBytes, type PackDraft, type PackDraftData } from '../../../packages/sudoku/src/packs.js'
import { parseGrid } from '../../../packages/sudoku/src/rules.js'
import { api, errorMessage, json, type Account } from './api.js'
import { SudokuPreview } from './Grid.js'

type PuzzleDraft = Pick<PublishedLevel, 'id' | 'title' | 'grid' | 'seed' | 'generatorVersion'> & { version: number }

const emptyPack: PackDraftData = { format: 1, game: 'sudoku', title: 'Untitled pack', description: '', theme: 'meadow',
  rules: { hints: true, autoNotes: true, inOrder: false, lives: null, timeTrial: false }, puzzles: [] }

function dataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export default function PackStudio({ account, levels, onPublish }: { account: Account; levels: PublishedLevel[]; onPublish: () => void }) {
  const t = useT()
  const [drafts, setDrafts] = useState<PackDraft[]>([])
  const [draft, setDraft] = useState<PackDraft>()
  const [data, setData] = useState(() => ({ ...emptyPack, title: t('Untitled pack') }))
  const [sourcePuzzle, setSourcePuzzle] = useState('')
  const [puzzleDrafts, setPuzzleDrafts] = useState<PuzzleDraft[]>([])
  const [puzzleTitle, setPuzzleTitle] = useState('')
  const [puzzleGrid, setPuzzleGrid] = useState('')
  const [previewIndex, setPreviewIndex] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const cleanup = new AbortController()
    void api<PackDraft[]>('/pack-drafts', { signal: cleanup.signal }, account.id).then(setDrafts, error => {
      if (!cleanup.signal.aborted) setProblem(errorMessage(error))
    })
    void api<PuzzleDraft[]>('/drafts', { signal: cleanup.signal }, account.id).then(setPuzzleDrafts, error => {
      if (!cleanup.signal.aborted) setProblem(errorMessage(error))
    })
    return () => cleanup.abort()
  }, [account.id])

  function load(item?: PackDraft) {
    setDraft(item); setData(item?.data ?? { ...emptyPack, title: t('Untitled pack') }); setPreviewIndex(undefined); setProblem(''); setMessage('')
  }
  function store(item: PackDraft) {
    setDrafts(items => [item, ...items.filter(other => other.id !== item.id)])
    load(item)
  }
  function task(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setProblem(''); setMessage('')
    void work().catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
  }
  function add(puzzle: PackDraftData['puzzles'][number]) {
    if (data.puzzles.length >= 30) {
      setProblem(t("Add up to 30 puzzles per pack."))
      return
    }
    setProblem('')
    setData({ ...data, puzzles: [...data.puzzles, puzzle] })
  }
  function reorder(index: number, offset: number) {
    const puzzles = [...data.puzzles]
    const item = puzzles.splice(index, 1)[0]
    puzzles.splice(index + offset, 0, item)
    setPreviewIndex(undefined)
    setData({ ...data, puzzles })
  }
  async function save() {
    if (draft?.data === data) return draft
    const saved = await api<PackDraft>(draft ? '/pack-drafts/' + draft.id : '/pack-drafts',
      json(draft ? 'PUT' : 'POST', draft ? { data, version: draft.version } : data), account.id)
    store(saved)
    return saved
  }

  const catalog = levels.map(level => ({ ...level,
    key: 'catalog:' + level.id + ':' + level.revision, title: levelTitle(t, level) }))
  const authored = puzzleDrafts.map(item => ({ ...item, key: 'draft:' + item.id + ':' + item.version }))
  const source = [...authored, ...catalog].find(item => item.key === sourcePuzzle)

  return <section className="pack-studio">
    <div className="section-heading"><h1>{t("Pack studio")}</h1>
      <label className="secondary file-label"><Upload size={16}/>{" "}{t("Import pack")}
        <input type="file" aria-label={t("Import pack")} accept=".aviarium-pack,.zip" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) task(async () => {
            if (file.size > packUploadBytes) throw new Error('This pack exceeds the upload limit.')
            const content = (await dataUrl(file)).split(',', 2)[1]
            store(await api<PackDraft>('/pack-drafts/import', json('POST', { content }), account.id))
            setMessage(t("Imported as a draft. Review it before publishing."))
          })
        }}/>
      </label>
    </div>
    {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    <div className="pack-studio-layout">
      <section className="panel padded pack-form">
        <h2>{t("Details")}</h2>
        <label>{t("Saved packs")}<select value={draft?.id ?? ''} disabled={busy}
          onChange={event => load(drafts.find(item => item.id === event.target.value))}>
          <option value="">{t("New pack")}</option>{drafts.map(item => <option key={item.id} value={item.id}>{item.data.title}</option>)}
        </select></label>
        <label>{t("Pack title")}<input maxLength={80} value={data.title} disabled={busy}
          onChange={event => setData({ ...data, title: event.target.value })}/></label>
        <label>{t("Description")}<textarea rows={3} maxLength={420} value={data.description} disabled={busy}
          onChange={event => setData({ ...data, description: event.target.value })}/></label>
        <label>{t("Theme")}<select value={data.theme} onChange={event => {
          const theme = event.target.value
          if (theme === 'meadow' || theme === 'twilight' || theme === 'sunrise') setData({ ...data, theme })
        }} disabled={busy}><option value="meadow">{t("Meadow")}</option><option value="twilight">{t("Twilight")}</option><option value="sunrise">{t("Sunrise")}</option></select></label>
        <div className="pack-art-inputs">{(['cover', 'background'] as const).map(key => <div key={key}>
          {data[key] && <img alt="" src={data[key]}/>}
          <label>{key === 'cover' ? t("Cover image") : t("Background image")}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) task(async () => {
                if (file.size > packImageBytes) throw new Error('Choose an image no larger than 512 KB.')
                const image = await dataUrl(file)
                setData(current => ({ ...current, [key]: image }))
              })
            }}/></label>
          {data[key] && <button className="text-button" disabled={busy}
            onClick={() => setData({ ...data, [key]: undefined })}>{t("Remove")}{" "}{key}</button>}
        </div>)}</div>
        <h2>{t("Rules")}</h2>
        <label>{t("Roadmap")}<select value={data.rules.inOrder ? 'ordered' : 'free'} disabled={busy}
          onChange={event => setData({ ...data, rules: { ...data.rules, inOrder: event.target.value === 'ordered' } })}>
          <option value="free">{t("Pick & choose")}</option><option value="ordered">{t("In order")}</option></select></label>
        {([['hints', t("Allow hints")], ['autoNotes', t("Allow Auto notes")], ['timeTrial', t("Time trial")]] as const).map(([key, label]) =>
          <label className="setting-row" key={key}>{label}<input type="checkbox" checked={data.rules[key]} disabled={busy}
            onChange={event => setData({ ...data, rules: { ...data.rules, [key]: event.target.checked } })}/></label>)}
        <label>{t("Lives")}<select value={data.rules.lives ?? ''} disabled={busy} onChange={event => {
          const lives = event.target.value ? Number(event.target.value) : null
          setData({ ...data, rules: { ...data.rules, lives } })
        }}><option value="">{t("Unlimited")}</option>{Array.from({ length: 9 }, (_, index) =>
          <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
      </section>
      <section className="panel padded pack-form">
        <h2>{t("Puzzles")}</h2>
        <div className="pack-add">
          <select aria-label={t('Add an existing puzzle')} value={sourcePuzzle} disabled={busy}
            onChange={event => setSourcePuzzle(event.target.value)}>
            <option value="">{t('Choose a puzzle')}</option>
            {!!authored.length && <optgroup label={t('Saved drafts')}>
              {authored.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
            </optgroup>}
            {!!catalog.length && <optgroup label={t('Legacy catalog')}>
              {catalog.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
            </optgroup>}
          </select>
          <button className="secondary" disabled={!source || busy} onClick={() => {
            if (source) add({ title: source.title, grid: source.grid, ruleset: 1,
              seed: source.seed ?? undefined, generatorVersion: source.generatorVersion ?? undefined })
          }}><Plus size={16}/>{' '}{t('Add')}</button>
        </div>
        <details><summary>{t("Add a Sudoku grid")}</summary>
          <label>{t("Puzzle title")}<input maxLength={100} value={puzzleTitle} onChange={event => setPuzzleTitle(event.target.value)}/></label>
          <label>{t("Grid")}<textarea value={puzzleGrid} rows={3} maxLength={300} onChange={event => setPuzzleGrid(event.target.value)}/></label>
          <button className="secondary" disabled={busy} onClick={() => {
            const grid = parseGrid(puzzleGrid)
            if (!grid || !puzzleTitle.trim()) { setProblem(t("Enter a title and 81 digits. Use 0 or a period for blanks.")); return }
            add({ title: puzzleTitle.trim(), grid: grid.join(''), ruleset: 1 })
          }}>{t("Add grid")}</button>
        </details>
        <ol className="pack-editor-stops">{data.puzzles.map((puzzle, index) => <li key={index}><button className="text-button"
          aria-expanded={previewIndex === index} aria-label={t('Preview {title}', { title: puzzle.title })}
          onClick={() => setPreviewIndex(previewIndex === index ? undefined : index)}>{index + 1}. {puzzle.title}</button>
          <div className="pack-edit-buttons">
            <button className="icon-button" disabled={busy || index === 0} aria-label={t('Move {title} up', { title: puzzle.title })}
              onClick={() => reorder(index, -1)}><ArrowUp size={17}/></button>
            <button className="icon-button" disabled={busy || index === data.puzzles.length - 1} aria-label={t('Move {title} down', { title: puzzle.title })}
              onClick={() => reorder(index, 1)}><ArrowDown size={17}/></button>
            <button className="icon-button" disabled={busy} aria-label={t('Remove {title}', { title: puzzle.title })}
              onClick={() => {
                setPreviewIndex(undefined)
                setData({ ...data, puzzles: data.puzzles.filter((_, position) => position !== index) })
              }}><Trash2 size={16}/></button>
          </div></li>)}</ol>
        {previewIndex !== undefined && data.puzzles[previewIndex] &&
          <div className="pack-editor-preview sudoku-theme"><SudokuPreview grid={data.puzzles[previewIndex].grid}/></div>}
        <div className="button-bar">
          <button className="secondary" disabled={busy || !data.title.trim()} onClick={() => task(async () => {
            await save(); setMessage(t("Pack draft saved."))
          })}><Save size={16}/>{" "}{t("Save pack")}</button>
          <button className="primary" disabled={busy || !data.title.trim() || !data.puzzles.length} onClick={() => task(async () => {
            const saved = await save()
            const published = await api<PackDraft>('/pack-drafts/' + saved.id + '/publish', json('POST', { version: saved.version }), account.id)
            store(published); setMessage(t('Published pack revision {revision}', { revision: published.published! })); onPublish()
          })}>{t("Publish pack")}</button>
        </div>
        {draft?.published && <div className="button-bar">
          <a className="secondary" href={`/api/packs/${draft.id}/${draft.published}/export`} download><Download size={16}/>{" "}{t("Export pack")}</a>
          <button className="text-button" disabled={busy} onClick={() => task(async () => {
            store(await api<PackDraft>('/pack-drafts/' + draft.id + '/visibility', json('PATCH', { visible: !draft.visible }), account.id))
            onPublish()
          })}>{draft.visible ? t("Hide from catalog") : t("Show in catalog")}</button>
        </div>}
      </section>
    </div>
  </section>
}
