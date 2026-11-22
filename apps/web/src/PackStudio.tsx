import { liveQuery } from 'dexie'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Download, Plus, Upload } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { assignPackLevels, authoringPack, packImageBytes, packLevelId, packLevelLimit, packProgressPath, packUploadBytes,
  type PackDraftRecord as PackDraft, type PackDocument as PackDraftData, type PackEntry as Puzzle, type PackRevision as PublishedPack } from '../../../packages/game-sdk/src/packs.js'
import { api, ApiError, errorMessage, json, type SessionAccount } from './api.js'
import { packApi, packExportUrl, PackRoadmap } from './GamePacks.js'
import type { LevelReview, StudioGame } from './game-studio.js'
import { knownMessage, useT } from './i18n.js'
import { PackLevelList } from './PackLevelList.js'
import { PackWorkspace } from './PackWorkspace.js'
import { db, type StudioPack } from './storage.js'
import { StudioRuleFields } from './StudioRuleFields.js'

function readFile(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

async function packArtwork(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image no larger than 512 KB.')
  if (file.size <= packImageBytes) return readFile(file)
  const image = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [.8, .6, .4]) {
      const data = canvas.toDataURL('image/webp', quality)
      if (data.length <= Math.ceil(packImageBytes / 3) * 4) return data
    }
  } finally { image.close() }
  throw new Error('Choose a PNG, JPEG, or WebP image no larger than 512 KB.')
}

function stableDraft(draft: PackDraft): PackDraft {
  return { ...draft, visible: draft.published !== null && draft.visible, data: authoringPack({ ...draft.data, puzzles: draft.data.puzzles.map((puzzle, index) =>
    ({ ...puzzle, levelId: puzzle.levelId ?? packLevelId(draft.id, index + 1) })) }) }
}

function newLevelId(packId: string) {
  return 'pack:' + packId + ':' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
}

export interface PackStudioProps {
  account: SessionAccount
  online: boolean
  admin?: boolean
  reader: boolean
  theme: 'light' | 'dark'
  packs: PublishedPack[]
  leave: () => void
  onPublish: () => void
}

export default function PackStudio({ game, account, online, admin = false, reader, theme, packs, leave, onPublish }:
  PackStudioProps & { game: StudioGame }) {
  const t = useT()
  const samplePacks = !admin && account.testRole ? packs.filter(pack => pack.builtIn) : []
  const scope = account.id + ':' + game.id + (admin ? '-admin' : '')
  const draftUrl = '/games/' + game.id + '/pack-drafts'
  const query = admin ? '?mode=admin' : ''
  const [records, setRecords] = useState<StudioPack[]>([])
  const [selected, setSelected] = useState<StudioPack>()
  const [levelId, setLevelId] = useState<string>()
  const [tab, setTab] = useState('levels')
  const [showLevelList, setShowLevelList] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [conflict, setConflict] = useState(false)
  const [syncing, setSyncing] = useState<string>()
  const [remoteConflicts, setRemoteConflicts] = useState<Set<string>>(new Set())
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const draftsInFlight = useRef(new Map<string, Promise<StudioPack>>())
  const acknowledged = useRef(new Map<string, PackDraft>())
  const departure = useRef({ online, remoteConflicts })
  departure.current = { online, remoteConflicts }
  const [notice, setNotice] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [deleteWillUnpublish, setDeleteWillUnpublish] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'light' | 'dark' | 'reader'>(reader ? 'reader' : theme)
  const [trial, setTrial] = useState<{ level: GameLevel; pack: PublishedPack }>()
  const [livePack, setLivePack] = useState<PublishedPack>()
  const [returning, setReturning] = useState(false)
  const [checks, setChecks] = useState<Record<string, LevelReview>>({})
  const [legacy, setLegacy] = useState<Puzzle[]>([])
  const trailPreview = useRef<HTMLDivElement>(null)
  const write = useRef<Promise<unknown>>(Promise.resolve())
  const active = useRef<StudioPack | undefined>(undefined)
  const onCheck = useCallback((key: string, result: LevelReview) => setChecks(current => ({ ...current, [key]: result })), [])

  useLayoutEffect(() => {
    if (!openDeleteDialog || busy) return
    deleteDialog.current?.showModal()
    setOpenDeleteDialog(false)
  }, [openDeleteDialog, busy])

  const editingId = selected?.draft.id
  const liveRevision = selected?.draft.published
  useLayoutEffect(() => {
    const trail = trailPreview.current
    if (tab === 'preview' && trail) trail.scrollTop = trail.scrollHeight
  }, [tab, editingId, trial])
  useEffect(() => {
    setLivePack(undefined)
    setReturning(false)
    if (!online || !editingId || !liveRevision) return
    const controller = new AbortController()
    void api<PublishedPack>(packApi(game.id) + '/' + editingId + '/' + liveRevision, { signal: controller.signal }, account.id)
      .then(pack => { if (!controller.signal.aborted) setLivePack(pack) }).catch(() => undefined)
    return () => controller.abort()
  }, [account.id, editingId, game.id, liveRevision, online])

  const selectedRules = selected?.draft.data.rules
  const pending = selectedRules && (tab === 'review' || tab === 'preview') ? selected?.draft.data.puzzles.find(
    puzzle => !checks[game.checkKey(puzzle, selectedRules)]) : undefined
  const pendingKey = pending && selectedRules ? game.checkKey(pending, selectedRules) : undefined
  useEffect(() => {
    if (!pendingKey || !pending || !selectedRules) return
    const controller = new AbortController()
    void game.check(pending, selectedRules, controller.signal).then(review => {
      if (!controller.signal.aborted) onCheck(pendingKey, review)
    }).catch(() => {
      if (!controller.signal.aborted) onCheck(pendingKey, { ready: false, status: 'Verification inconclusive' })
    })
    return () => controller.abort()
  }, [game, onCheck, pendingKey])

  function wrap(draft: PackDraft, dirty = false): StudioPack {
    return { key: scope + ':' + draft.id, scope, draft: stableDraft(draft), dirty }
  }

  useEffect(() => {
    const subscription = liveQuery(() => db.studioPacks.where('scope').equals(scope).toArray()).subscribe({
      next: result => setRecords(result.sort((a, b) => a.draft.data.title.localeCompare(b.draft.data.title))),
      error: error => setProblem(errorMessage(error)),
    })
    return () => subscription.unsubscribe()
  }, [scope])

  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    void Promise.all([api<PackDraft[]>(draftUrl + query, { signal: controller.signal }, account.id),
      db.studioPacks.where('scope').equals(scope).toArray()]).then(async ([drafts, baseline]) => {
      if (controller.signal.aborted) return
      await db.transaction('rw', db.studioPacks, async () => {
        const local = await db.studioPacks.where('scope').equals(scope).toArray()
        const byId = new Map(local.map(item => [item.draft.id, item]))
        const incoming = new Set(drafts.map(item => item.id))
        await db.studioPacks.bulkDelete(local.filter(item => !item.dirty && !incoming.has(item.draft.id) &&
          baseline.some(old => old.key === item.key && old.draft.version === item.draft.version && old.localEdit === item.localEdit))
          .map(item => item.key))
        await db.studioPacks.bulkPut(drafts.filter(draft => {
          const item = byId.get(draft.id)
          return !item || (!item.dirty && item.draft.version < draft.version)
        }).map(draft =>
          ({ key: scope + ':' + draft.id, scope, draft: stableDraft(draft), dirty: false })))
      })
    }).catch(error => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    if (!admin) void game.legacyDrafts?.(account.id, controller.signal).then(setLegacy).catch(() => undefined)
    return () => controller.abort()
  }, [account.id, admin, online, query, scope])

  function show(record?: StudioPack) {
    active.current = record
    setSelected(record)
  }

  function enqueueWrite<T>(run: () => Promise<T>) {
    const pending = write.current.catch(() => undefined).then(run)
    write.current = pending
    return pending
  }

  function persist(record: StudioPack) {
    const edit = { ...record, localEdit: crypto.randomUUID() }
    show(edit)
    setSaved(false); setNotice('')
    void enqueueWrite(async () => {
      const base = acknowledged.current.get(edit.key)
      const latest = base && base.version > edit.draft.version
        ? { ...edit, draft: { ...base, data: edit.draft.data } } : edit
      await db.studioPacks.put(latest)
      if (active.current?.localEdit === edit.localEdit) {
        show(latest); setSaved(true)
      }
    }).catch(error => {
      if (active.current?.localEdit === edit.localEdit) setProblem(errorMessage(error))
    })
  }

  function edit(change: (data: PackDraftData) => PackDraftData) {
    const item = active.current
    if (item) persist({ ...item, dirty: true, draft: { ...item.draft, data: authoringPack(change(item.draft.data)) } })
  }

  function open(record?: StudioPack) {
    show(record && { ...record, draft: stableDraft(record.draft) }); setTab('levels'); setLevelId(record?.draft.data.puzzles[0]?.levelId)
    setShowLevelList(false); setTrial(undefined); setProblem(''); setConflict(false); setNotice(''); setSaved(Boolean(record))
  }

  function create(data: PackDraftData) {
    const id = crypto.randomUUID()
    const puzzles = data.puzzles.map(puzzle => ({ ...puzzle, levelId: newLevelId(id), levelRevision: undefined }))
    const record = wrap({ id, version: 0, published: null, visible: false, data: { ...data, puzzles } }, true)
    open(record); persist(record)
  }

  function task(run: () => Promise<void>) {
    if (busy) return
    setBusy(true); setProblem(''); setConflict(false)
    void run().catch(error => {
      setProblem(errorMessage(error))
      setConflict(error instanceof ApiError && error.status === 409)
    }).finally(() => setBusy(false))
  }

  function syncRecord(key: string) {
    const pending = draftsInFlight.current.get(key)
    if (pending) return pending
    const save = (async () => {
      const current = await enqueueWrite(() => db.studioPacks.get(key))
      if (!current) throw new Error('This pack draft is unavailable.')
      if (!current.dirty && current.draft.version) return current
      const { data, id, version } = current.draft
      setSyncing(key)
      const response = await api<PackDraft>(version ? draftUrl + '/' + id + query : draftUrl,
        json(version ? 'PUT' : 'POST', version ? { data, version } : { ...data, localId: id }), account.id)
      const remote = stableDraft({ ...response, ownerName: response.ownerName ?? current.draft.ownerName })
      return enqueueWrite(async () => {
        const next = await db.transaction('rw', db.studioPacks, async () => {
          const latest = await db.studioPacks.get(key)
          if (!latest || latest.draft.version > remote.version) return latest
          const unchanged = latest.localEdit === current.localEdit
          const updated = { ...latest, dirty: !unchanged,
            draft: { ...remote, data: latest.draft.data } }
          await db.studioPacks.put(updated)
          return updated
        })
        if (!next) return current
        acknowledged.current.set(key, next.draft)
        if (active.current?.key === key && active.current.localEdit === next.localEdit) {
          show(next); setSaved(true)
        }
        return next
      })
    })().finally(() => {
      draftsInFlight.current.delete(key)
      setSyncing(current => current === key ? undefined : current)
    })
    draftsInFlight.current.set(key, save)
    return save
  }

  useEffect(() => {
    if (!online || busy) return
    const next = records.find(record => record.dirty && !remoteConflicts.has(record.key) && game.accepts(record.draft.data))
    if (!next) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    function save() {
      if (stopped || !next) return
      void syncRecord(next.key).catch(error => {
        if (error instanceof ApiError && error.status === 409) {
          setRemoteConflicts(current => new Set([...current, next.key]))
        } else if (!stopped) timer = setTimeout(save, 8000)
      })
    }
    timer = setTimeout(save, 850)
    return () => { stopped = true; clearTimeout(timer) }
  }, [records, online, busy, remoteConflicts, account.id, query])

  useEffect(() => () => {
    const state = departure.current
    if (!state.online) return
    void write.current.catch(() => undefined).then(async () => {
      const stored = await db.studioPacks.where('scope').equals(scope).toArray()
      for (const item of stored) {
        if (!item.dirty || state.remoteConflicts.has(item.key) || !game.accepts(item.draft.data)) continue
        try {
          let uploaded = await syncRecord(item.key)
          while (uploaded.dirty && game.accepts(uploaded.draft.data))
            uploaded = await syncRecord(item.key)
        } catch { /* The local draft remains available when Studio is reopened. */ }
      }
    }).catch(() => undefined)
  }, [scope])

  async function syncDraft() {
    if (!active.current) throw new Error('This pack draft is unavailable.')
    const key = active.current.key
    let uploaded = await syncRecord(key)
    while (uploaded.dirty) uploaded = await syncRecord(key)
    return uploaded.draft
  }

  function add(input?: Puzzle, after?: number) {
    const item = active.current
    if (!item || item.draft.data.puzzles.length >= packLevelLimit) return
    const levelId = newLevelId(item.draft.id)
    edit(data => {
      const puzzles = [...data.puzzles]
      puzzles.splice(after === undefined ? puzzles.length : after + 1, 0, { ...game.createLevel(t, input), levelId })
      return { ...data, puzzles }
    })
    setLevelId(levelId); setTab('levels'); setShowLevelList(false)
  }

  function move(index: number, target: number) {
    edit(data => {
      const puzzles = [...data.puzzles]
      const [item] = puzzles.splice(index, 1)
      puzzles.splice(target, 0, item)
      return { ...data, puzzles }
    })
  }

  const feedback = problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>
  if (!selected) return <section className="pack-workspace">
    <div className="section-heading"><div>
      <button className="text-button" onClick={leave}><ArrowLeft size={17}/> {t(admin ? 'Administration' : 'Studio games')}</button>
      <h1>{admin ? t('Edit as admin') : t('My packs')}</h1>
      <p>{admin ? t('Choose a creator’s pack to open its shared draft.') : t('Create a pack and build its trail one puzzle at a time.')}</p></div>
      {!admin && online && <label className="secondary file-label"><Upload size={16}/> {t('Import pack')}
        <input type="file" aria-label={t('Import pack')} accept=".aviarium-pack,.zip" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) task(async () => {
            if (file.size > packUploadBytes) throw new Error('This pack exceeds the upload limit.')
            const content = (await readFile(file)).split(',', 2)[1]
            const record = wrap(await api<PackDraft>(draftUrl + '/import', json('POST', { content }), account.id))
            await db.studioPacks.put(record); open(record)
          })
        }}/></label>}
    </div>
    {feedback}
    {!admin && <form className="panel padded studio-new-pack" onSubmit={event => {
      event.preventDefault()
      if (title.trim()) { create(game.createPack(title.trim())); setTitle('') }
    }}>
      <label>{t('Pack title')}<input value={title} required maxLength={80} onChange={event => setTitle(event.target.value)}/></label>
      <button className="primary" type="submit"><Plus size={16}/> {t('New pack')}</button>
    </form>}
    {samplePacks.length > 0 && <section className="studio-test-packs" aria-labelledby="studio-test-packs-title">
      <div><h2 id="studio-test-packs-title">{t('Built-in packs for testing')}</h2>
        <p>{t('Copy a built-in pack to get a draft with puzzles and artwork.')}</p></div>
      <ul>{samplePacks.map(pack => <li key={pack.id}>
        {pack.data.cover && <img src={pack.data.cover} alt=""/>}
        <strong>{game.presentation.title(t, pack)}</strong>
        <button className="secondary" type="button" onClick={() => {
          const title = game.presentation.title(t, pack)
          setChecks(current => ({ ...current, ...Object.fromEntries(pack.data.puzzles.map(item => [
            game.checkKey(item, pack.data.rules), game.verified(item),
          ])) }))
          create({ ...pack.data, title: t('{title} (test copy)', { title }).slice(0, 80), description: game.presentation.description(t, pack) })
        }}>{t('Make test copy')}</button>
      </li>)}</ul>
    </section>}
    <ul className="studio-pack-list">{records.map(record => <li className="panel padded" key={record.key}>
      <div><h2>{record.draft.data.title}</h2>
        <p>{[record.draft.ownerName, record.draft.visible && record.draft.published ? t('Live revision {revision}', { revision: record.draft.published })
          : record.draft.published ? t('Unpublished') : t('Draft'),
          record.dirty ? t('Changes on this device') : t('Draft saved online')].filter(Boolean).join(' · ')}</p></div>
      <button className="secondary" onClick={() => open(record)}>{admin ? t('Edit as admin') : t('Open pack')}</button>
    </li>)}</ul>
  </section>

  const { draft, dirty } = selected
  const selectedKey = selected.key
  const syncConflict = conflict || remoteConflicts.has(selected.key)
  const data = draft.data
  async function currentRecord() {
    await draftsInFlight.current.get(selectedKey)?.catch(() => undefined)
    await write.current
    const current = await db.studioPacks.get(selectedKey)
    if (!current) throw new Error('This pack draft is unavailable.')
    return current
  }

  function unpublishPack() {
    task(async () => {
      const current = await currentRecord()
      const remote = await api<PackDraft>(draftUrl + '/' + draft.id + '/visibility' + query,
        json('PATCH', { visible: false, version: current.draft.version }), account.id)
      await enqueueWrite(async () => {
        const next = await db.transaction('rw', db.studioPacks, async () => {
          const latest = await db.studioPacks.get(current.key)
          if (!latest || latest.draft.version !== current.draft.version) return latest
          const updated = { ...latest, draft: { ...latest.draft, version: remote.version,
            visible: remote.visible, lastEditedBy: remote.lastEditedBy } }
          await db.studioPacks.put(updated)
          return updated
        })
        if (!next) return
        acknowledged.current.set(next.key, next.draft)
        if (active.current?.key === next.key &&
          (active.current.localEdit === next.localEdit || active.current.localEdit === current.localEdit)) show(next)
      })
      setNotice(t('Pack unpublished')); onPublish()
    })
  }

  function confirmDelete() {
    task(async () => {
      const current = await currentRecord()
      const status = current.draft.version ? await api<{ visible: boolean }>(
        draftUrl + '/' + draft.id + '/status' + query, undefined, account.id) : current.draft
      setDeleteWillUnpublish(status.visible)
      setOpenDeleteDialog(true)
    })
  }

  function deletePack() {
    task(async () => {
      const current = await currentRecord()
      if (current.draft.version || online) {
        const deleteQuery = new URLSearchParams(query)
        if (deleteWillUnpublish) deleteQuery.set('unpublish', 'true')
        try {
          await api(draftUrl + '/' + draft.id + '?' + deleteQuery, { method: 'DELETE' }, account.id)
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && !deleteWillUnpublish) {
            setDeleteWillUnpublish(true)
            return
          }
          if (current.draft.version || !(error instanceof ApiError && error.status === 404)) throw error
        }
      }
      await enqueueWrite(() => db.studioPacks.delete(current.key))
      deleteDialog.current?.close()
      open(); onPublish()
    })
  }

  const puzzle = data.puzzles.find(item => item.levelId === levelId)
  const previous = livePack?.id === draft.id && livePack.revision === draft.published ? livePack : undefined
  const before = previous?.data.puzzles ?? []
  const beforeLevel = previous ? game.presentation.levels(previous) : []
  const checkAt = (item: Puzzle) => {
    const key = game.checkKey(item, data.rules)
    const known = previous && before.find(old => old.levelId === item.levelId && game.checkKey(old, previous.data.rules) === key)
    return checks[key] ?? (known && game.verified(known))
  }
  const preview: PublishedPack = { id: draft.id, revision: (draft.published ?? 0) + 1, builtIn: false,
    history: previous ? [...(previous.history ?? []), ...(previous.history?.some(path => path.revision === previous.revision) ? [] : [packProgressPath(previous)])] : [],
    data: { ...data, puzzles: data.puzzles.map(item => game.preview(item, data.rules, checkAt(item))) } }
  preview.data.puzzles = assignPackLevels(preview, previous, game.sameLevel) ?? preview.data.puzzles
  const oldRetained = beforeLevel.filter(old => data.puzzles.some(item => item.levelId === old.id)).map(level => level.id)
  const newRetained = data.puzzles.filter(item => oldRetained.includes(item.levelId ?? '')).map(item => item.levelId)
  const reviews = new Map(data.puzzles.map(item => [item.levelId, checkAt(item)]))
  const details = new Map(data.puzzles.flatMap(item => {
    const detail = reviews.get(item.levelId)?.detail
    return item.levelId ? [[item.levelId, detail && t(detail)] as const] : []
  }))
  const returningCompletions = beforeLevel.map(level => ({ level: level.id, revision: level.revision, packRevision: previous?.revision }))
  async function publish() {
    const current = await syncDraft()
    setPublishing(true)
    try {
      const remote = await api<PackDraft>(draftUrl + '/' + current.id + '/publish' + query,
        json('POST', { version: current.version }), account.id)
      const record = wrap({ ...remote, ownerName: remote.ownerName ?? draft.ownerName })
      await db.studioPacks.put(record)
      show(record); setSaved(true)
      setNotice(t('Published pack revision {revision}', { revision: remote.published ?? 1 }))
      setTab('levels'); onPublish()
    } finally { setPublishing(false) }
  }

  function startTrial(level: GameLevel) {
    if (!reviews.get(level.id)?.ready) { setProblem(t('Check this level before test play.')); return }
    setTrial({ level, pack: preview })
  }

  if (trial) return <div className={'app studio-preview studio-test-play' + (mode === 'reader' ? ' reader' : '')}
    data-theme={mode === 'dark' ? 'dark' : 'light'}>
    <div className={`game-theme ${game.theme} pack-${trial.pack.data.theme} pack-palette studio-pack-preview`}>
      <p className="notice">{t('Test play · progress stays in this preview')}</p>
      <game.Trial key={trial.level.id} {...trial} profile={account.id} reader={mode === 'reader'} leave={() => setTrial(undefined)}/>
    </div>
  </div>

  const canPublish = data.puzzles.length > 0 && Boolean(data.title.trim()) &&
    data.puzzles.every(item => item.title.trim() && checkAt(item)?.ready)
  const tabs = [{ id: 'levels', title: t('Levels') }, { id: 'appearance', title: t('Appearance') },
    { id: 'rules', title: t('Rules') }, { id: 'preview', title: t('Preview') }]
  function chooseLevel(id: string | undefined) { setLevelId(id); setTab('levels'); setShowLevelList(false) }

  const sidebar = tab === 'levels' ? <>
    <div className="section-heading"><h2 className="studio-level-heading">{t('Levels')}</h2>
      <button className="secondary studio-toggle-levels" aria-expanded={showLevelList} onClick={() => setShowLevelList(!showLevelList)}>
        {puzzle ? t('Levels · {position} of {total}', {
          position: data.puzzles.indexOf(puzzle) + 1, total: data.puzzles.length,
        }) : t('Levels')}
      </button>
      <button className="secondary" disabled={busy || data.puzzles.length >= packLevelLimit} onClick={() => add()}><Plus size={16}/> {t('Add level')}</button>
    </div>
    <div className={'studio-level-panel' + (showLevelList ? ' is-open' : '')}>
      <PackLevelList levels={data.puzzles.map(item => {
        const detail = checkAt(item)?.detail
        return { id: item.levelId!, title: item.title || t('Untitled puzzle'),
          detail: [item.chapter, detail ? t(detail) : t('Ungraded')].filter(Boolean).join(' · ') }
      })} selected={levelId} disabled={busy} canInsert={data.puzzles.length < packLevelLimit}
        select={chooseLevel} move={move} insert={index => add(undefined, index)} remove={id => {
          const index = data.puzzles.findIndex(item => item.levelId === id)
          if (!window.confirm(t('Remove {title} from this pack draft?', { title: data.puzzles[index].title }))) return
          edit(current => ({ ...current, puzzles: current.puzzles.filter(item => item.levelId !== id) }))
          if (id === levelId) setLevelId(data.puzzles[index + 1]?.levelId ?? data.puzzles[index - 1]?.levelId)
        }}/>
    </div>
    {data.puzzles.length === packLevelLimit && <p>{t('Add up to 30 puzzles per pack.')}</p>}
    {legacy.length > 0 && <label>{t('Bring in a saved puzzle')}<select value="" disabled={busy || data.puzzles.length >= packLevelLimit} onChange={event => {
      const item = legacy.find(draft => draft.levelId === event.target.value)
      if (item) add(item)
    }}><option value="">{t('Saved drafts')}</option>{legacy.map(item => <option key={item.levelId} value={item.levelId}>{item.title}</option>)}</select></label>}
  </> : undefined

  return <PackWorkspace title={data.title || t('Untitled pack')} sections={tabs} active={tab} choose={setTab} sidebar={sidebar}
    navigation={<button className="text-button studio-pack-back" onClick={() => open()} disabled={busy}><ArrowLeft size={17}/> {admin ? t('Edit as admin') : t('My packs')}</button>}
    context={<><p role="status">{publishing ? t('Verifying pack on the server…') : busy ? t('Working…') : notice ||
      (syncConflict ? t('Draft saved here · online copy changed') : syncing === selected.key ? t('Saving draft online…')
        : saved ? dirty ? t('Saved on this device') : t('Draft saved online') : t('Saving on this device…'))}</p>
      {admin && <p className="notice">{t('Editing as admin')}{draft.ownerName && ' · ' + draft.ownerName}</p>}</>}
    actions={<>
      {tab !== 'review' && <>
        <button className="text-button" disabled={busy || (!online && Boolean(draft.version))}
          onClick={confirmDelete}>{t('Delete pack')}</button>
        {draft.visible && <button className="secondary" disabled={busy || !online}
          onClick={unpublishPack}>{t('Unpublish')}</button>}
        <button className="primary" disabled={busy} onClick={() => setTab('review')}>
          {t(draft.visible ? 'Publish update' : 'Publish pack')}
        </button>
      </>}
    </>}>
    {feedback}
    <dialog className="studio-delete-dialog" ref={deleteDialog} aria-labelledby="studio-delete-title"
      aria-describedby="studio-delete-description" onCancel={event => { if (busy) event.preventDefault() }}>
      <h2 id="studio-delete-title">{t('Delete {title}?', { title: data.title })}</h2>
      <p id="studio-delete-description">{t(deleteWillUnpublish ? 'This will also un-publish it.' : 'This removes the pack from My packs.')}</p>
      {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
      <div className="button-bar">
        <button className="secondary" type="button" autoFocus disabled={busy}
          onClick={() => deleteDialog.current?.close()}>{t('Cancel')}</button>
        <button className="primary studio-delete-confirm" type="button" disabled={busy} onClick={deletePack}>{t('Delete pack')}</button>
      </div>
    </dialog>
    {syncConflict && <div className="button-bar">
      {!admin && <button className="secondary" onClick={() => create(data)}>{t('Save as a new pack')}</button>}
      <button className="text-button" disabled={!online} onClick={() => {
        if (!window.confirm(t('Replace the local draft with the synced version?'))) return
        task(async () => {
          const results = await api<PackDraft[]>(draftUrl + query, undefined, account.id)
          const remote = results.find(item => item.id === draft.id)
          if (!remote) throw new Error('This pack draft is unavailable.')
          const next = wrap(remote)
          await db.studioPacks.put(next)
          setRemoteConflicts(current => new Set([...current].filter(key => key !== selected.key)))
          open(next)
        })
      }}>{t('Open synced version')}</button>
    </div>}
    <fieldset className="studio-fields" disabled={busy}>
      {tab === 'levels' && (puzzle ? <game.Editor key={puzzle.levelId} level={puzzle} rules={data.rules} onCheck={onCheck}
        update={patch => edit(current => ({ ...current, puzzles: current.puzzles.map(item => item.levelId === puzzle.levelId ? { ...item, ...patch } : item) }))}
        trial={() => {
          const level = game.presentation.levels(preview).find(item => item.id === puzzle.levelId)
          if (level) startTrial(level)
        }}/> : <p className="empty">{t('Add a level to open the level editor.')}</p>)}
      {tab === 'appearance' && <div className="panel padded pack-form studio-appearance-fields">
        <label>{t('Pack title')}<input value={data.title} maxLength={80} onChange={event => edit(current => ({ ...current, title: event.target.value }))}/></label>
        <label>{t('Description')}<textarea aria-label={t('Description')} rows={3} value={data.description} maxLength={420}
          onChange={event => edit(current => ({ ...current, description: event.target.value }))}/></label>
        <fieldset className="studio-theme-picker"><legend>{t('Theme')}</legend>
          <div className="studio-theme-options">
            {game.themes.map(({ id, name }) => <label key={id} className="studio-theme-option">
              <input type="radio" name="pack-theme" value={id} checked={data.theme === id}
                onChange={() => edit(current => ({ ...current, theme: id }))}/>
              <span className="studio-theme-name">{t(name)}{data.theme === id && <Check size={16} aria-hidden="true"/>}</span>
              <span className="studio-theme-pair" aria-hidden="true">
                {(['light', 'dark'] as const).map(mode => <span key={mode} className="studio-theme-sample">
                  <span className="app studio-preview studio-theme-demo" data-theme={mode}>
                    <span className={`game-theme ${game.theme} pack-${id}`}>
                      <span className="studio-swatch-face"><span>Aa</span><i/><b/></span>
                    </span>
                  </span>
                  <small>{t(mode === 'light' ? 'Light' : 'Dark')}</small>
                </span>)}
              </span>
            </label>)}
          </div>
          <div className="button-bar studio-theme-preview-link">
            <button className="text-button" type="button" onClick={() => setTab('preview')}>{t('Preview theme')}</button>
            <p>{t('E-reader displays the pack in grayscale.')}</p>
          </div>
        </fieldset>
        <div className="pack-art-inputs">{(['cover', 'background'] as const).map(key => <div key={key}>
          {data[key] && <img alt="" src={data[key]}/>}
          <label>{key === 'cover' ? t('Cover image') : t('Background image')}
            <input type="file" aria-label={key === 'cover' ? t('Cover image') : t('Background image')}
              accept="image/png,image/jpeg,image/webp"  onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ''
              if (file) task(async () => { const image = await packArtwork(file); edit(current => ({ ...current, [key]: image })) })
            }}/></label>
          {data[key] && <button className="text-button" type="button" onClick={() => edit(current => ({ ...current, [key]: undefined }))}>{t('Remove')}</button>}
        </div>)}</div>
      </div>}
      {tab === 'rules' && <div className="panel padded pack-form"><h2>{t('Pack rules')}</h2>
        <p>{t('Levels use these rules unless you override them in the level editor.')}</p>
        <StudioRuleFields values={data.rules} groups={game.rules} update={patch => edit(current => ({ ...current, rules: { ...current.rules, ...patch } }))}/>
      </div>}
      {tab === 'review' && <div className="panel padded pack-form studio-review">
        <h2>{t(draft.visible ? 'Publish update' : 'Publish pack')}</h2>
        <p>{t(draft.visible ? 'This replaces the current version in the {game} catalog on this instance.'
          : 'This makes the pack available to players in the {game} catalog on this instance.', { game: game.title })}</p>
        {!data.puzzles.length && <p>{t('Add a level to open the level editor.')}</p>}
        {!data.title.trim() && <button className="text-button" onClick={() => setTab('appearance')}>{t('Enter a pack title')}</button>}
        <ul>{data.puzzles.map((item, index) => {
          const oldIndex = beforeLevel.findIndex(level => level.id === item.levelId)
          const changed = preview.data.puzzles[index].levelRevision === preview.revision
          const result = checkAt(item)
          const status = result ? t(result.detail ?? result.status) : t('Checking puzzle…')
          const moved = oldIndex >= 0 && oldRetained.indexOf(item.levelId ?? '') !== newRetained.indexOf(item.levelId)
          return <li key={item.levelId}>
            <button className="text-button" onClick={() => chooseLevel(item.levelId)}>{index + 1}. {item.title || t('Untitled puzzle')}</button>
            <span>{[!item.title.trim() ? t('Enter a puzzle title') : status, previous &&
              (oldIndex < 0 ? t('Added') : changed ? t('Changed') : undefined),
              moved && t('Moved')].filter(Boolean).join(' · ')}</span>
          </li>
        })}
        {beforeLevel.filter(old => !data.puzzles.some(item => item.levelId === old.id)).map(old =>
          <li key={old.id}><span>{old.title} · {t('Removed')}</span></li>)}</ul>
        {previous && <div>
          <p>{t('See what a player who finished the previous revision can access after this update.')}</p>
          <button className="secondary" onClick={() => { setReturning(true); setTab('preview') }}>{t('Preview returning player')}</button>
        </div>}
        {!online && <p>{t('Connect to publish this pack.')}</p>}
        <div className="button-bar studio-publish-actions">
          <button className="text-button" type="button" onClick={() => setTab('levels')}>{t('Back to editor')}</button>
          <button className="primary" disabled={busy || !online || !canPublish} onClick={() => task(publish)}>
            {t(busy ? 'Working…' : 'Publish to catalog')}
          </button>
        </div>
      </div>}
      {tab === 'preview' && <>
        <div className="studio-preview-controls">
          <div className="tabs">{(['light', 'dark', 'reader'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value}
            onClick={() => setMode(value)}>{t(value === 'reader' ? 'E-reader' : value === 'dark' ? 'Dark' : 'Light')}</button>)}</div>
          {data.puzzles.length > 0 && <button className="text-button" type="button" onClick={() => {
            const trail = trailPreview.current
            trail?.scrollTo({ top: trail.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
          }}>{t('Show pack start')}</button>}
        </div>
        {previous && <div className="button-bar">
          <button className="text-button" aria-pressed={!returning} onClick={() => setReturning(false)}>{t('New player')}</button>
          <button className="text-button" aria-pressed={returning} onClick={() => setReturning(true)}>{t('Returning player')}</button>
        </div>}
        <div ref={trailPreview} className={'app studio-preview studio-trail-preview' + (mode === 'reader' ? ' reader' : '')}
          data-theme={mode === 'dark' ? 'dark' : 'light'} role="region" aria-label={t('Pack trail preview')} tabIndex={0}>
          <div className={`game-theme ${game.theme} pack-${data.theme} studio-pack-preview`}><PackRoadmap presentation={game.presentation} pack={preview} completed={new Set()} previewCompletions={returning ? returningCompletions : undefined} sessions={[]} canExport={false}
            canPlay preview previewDetails={details} leave={() => setTab('levels')} play={startTrial}/></div>
        </div>
      </>}
    </fieldset>
    {Boolean(draft.published) && online && tab === 'preview' && <div className="button-bar">
      <a className="secondary" href={packExportUrl({ id: draft.id, revision: draft.published!, data })} download><Download size={16}/> {t('Export pack')}</a>
    </div>}
  </PackWorkspace>
}
