import { liveQuery } from 'dexie'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowDown, ArrowUp, Check, Download, Plus, Trash2, Upload } from 'lucide-react'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import { assignPackLevels, authoringPack, packChapterLimit, packImageBytes, packLevelId, packLevelLimit,
  packProgressPath, packStopAt, packUploadBytes, upgradePackDocument, type PackChapter, type PackDraftRecord as PackDraft,
  type PackDocument as PackDraftData, type PackEntry as Puzzle, type PackRevision as PublishedPack } from '../../../packages/game-sdk/src/packs.js'
import { api, ApiError, errorMessage, json, type SessionAccount } from './api.js'
import { PackChapters, packApi, packExportUrl, PackRoadmap } from './GamePacks.js'
import { packLevels } from './game-definitions.js'
import type { LevelReview, StudioGame } from './game-studio.js'
import { knownMessage, useT } from './i18n.js'
import { navigationLayer, pushLayer } from './navigation.js'
import { PackLevelList } from './PackLevelList.js'
import { randomId } from './random.js'
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
  const seen = new Set<string>()
  const data = upgradePackDocument(draft.data) as PackDraftData
  const chapters = data.chapters.map((chapter, chapterIndex) => {
    let id = chapter.id || 'chapter-' + (chapterIndex + 1)
    while (seen.has(id)) id = 'chapter-' + Math.random().toString(36).slice(2, 10)
    seen.add(id)
    return { ...chapter, id, puzzles: chapter.puzzles.map((puzzle, index) =>
      ({ ...puzzle, levelId: puzzle.levelId ?? packLevelId(draft.id, id, index + 1) })) }
  })
  return { ...draft, visible: draft.published !== null && draft.visible, data: authoringPack({ ...data, chapters }) }
}

function newLevelId(packId: string) {
  return 'pack:' + packId + ':' + randomId().replaceAll('-', '').slice(0, 20)
}

function newChapterId() {
  return 'chapter-' + randomId().replaceAll('-', '').slice(0, 12)
}

export interface PackStudioProps {
  account: SessionAccount
  online: boolean
  admin?: boolean
  reader: boolean
  theme: 'light' | 'dark'
  packs: PublishedPack[]
  leave: () => void
  /** Where the exit returns to: the Studio hub, or the game menu it was opened from. */
  leaveLabel: string
  onPublish: () => void
}

type Chapter = PackDraftData['chapters'][number]
type ChapterPuzzle = Chapter['puzzles'][number]

export default function PackStudio({ game, account, online, admin = false, reader, theme, packs, leave, leaveLabel, onPublish }:
  PackStudioProps & { game: StudioGame }) {
  const t = useT()
  const samplePacks = !admin && account.testRole ? packs.filter(pack => pack.builtIn) : []
  const scope = account.id + ':' + game.id + (admin ? '-admin' : '')
  const draftUrl = '/games/' + game.id + '/pack-drafts'
  const query = admin ? '?mode=admin' : ''
  const routePath = location.pathname.replace(/\/$/, '') || '/'
  const [records, setRecords] = useState<StudioPack[]>([])
  const recordsRef = useRef(records)
  recordsRef.current = records
  const [selected, setSelected] = useState<StudioPack>()
  const [chapterId, setChapterId] = useState<string>()
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
  }, [tab, editingId, chapterId, trial])
  useEffect(() => {
    setLivePack(undefined)
    setReturning(false)
    if (!online || !editingId || !liveRevision) return
    const controller = new AbortController()
    void api<PublishedPack>(packApi(game.id) + '/' + editingId + '/' + liveRevision, { signal: controller.signal }, account.id)
      .then(pack => { if (!controller.signal.aborted) setLivePack(pack) }).catch(() => undefined)
    return () => controller.abort()
  }, [account.id, editingId, game.id, liveRevision, online])

  const selectedChapter = selected?.draft.data.chapters.find(chapter => chapter.id === chapterId) ??
    selected?.draft.data.chapters[0]
  const pending = selected && (tab === 'review' || tab === 'preview')
    ? selected.draft.data.chapters.flatMap(chapter => chapter.puzzles.map(puzzle => ({ puzzle, rules: chapter.rules })))
      .find(item => !checks[game.checkKey(item.puzzle, item.rules)])
    : undefined
  const pendingKey = pending ? game.checkKey(pending.puzzle, pending.rules) : undefined
  useEffect(() => {
    if (!pendingKey || !pending) return
    const controller = new AbortController()
    void game.check(pending.puzzle, pending.rules, controller.signal).then(review => {
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

  useEffect(() => {
    function layerChanged() {
      if ((location.pathname.replace(/\/$/, '') || '/') !== routePath) return
      const layer = navigationLayer(history.state)
      if (layer?.studio === 'pack' || layer?.studio === 'trial') {
        if (!active.current && layer.studioPack) {
          const cached = recordsRef.current.find(item => item.draft.id === layer.studioPack)
          if (cached) openEditor(cached)
          else void db.studioPacks.get(scope + ':' + layer.studioPack).then(record => {
            if (!record) return
            const current = navigationLayer(history.state)
            if ((location.pathname.replace(/\/$/, '') || '/') === routePath &&
                current?.studio && current.studioPack === layer.studioPack) openEditor(record)
          }, () => undefined)
        }
        setTrial(undefined)
        return
      }
      openEditor(undefined)
    }
    window.addEventListener('popstate', layerChanged)
    return () => window.removeEventListener('popstate', layerChanged)
  }, [routePath, scope])

  useEffect(() => {
    // A reload or a back step into this URL has no selected draft yet. Restore
    // the pack layer from the local draft so Back continues from the editor.
    // Test play cannot be restored without its level, so step back to the pack.
    const layer = navigationLayer(history.state)
    if (layer?.studio === 'trial') {
      history.back()
      return
    }
    if (layer?.studio === 'pack' && layer.studioPack) {
      let cancelled = false
      void db.studioPacks.get(scope + ':' + layer.studioPack).then(record => {
        const current = navigationLayer(history.state)
        if (!cancelled && record && current?.studio && current.studioPack === layer.studioPack) openEditor(record)
      }, () => undefined)
      return () => { cancelled = true }
    }
  }, [scope])

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
    const edit = { ...record, localEdit: randomId() }
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

  function editChapter(id: string, change: (chapter: Chapter) => Chapter) {
    edit(data => ({ ...data, chapters: data.chapters.map(chapter => chapter.id === id ? change(chapter) : chapter) }))
  }

  function openEditor(record?: StudioPack) {
    const next = record && { ...record, draft: stableDraft(record.draft) }
    const chapter = next?.draft.data.chapters[0]
    show(next)
    setChapterId(chapter?.id)
    setLevelId(chapter?.puzzles[0]?.levelId)
    setTab(next && next.draft.data.chapters.length > 1 ? 'chapters' : 'levels')
    setShowLevelList(false); setTrial(undefined); setProblem(''); setConflict(false); setNotice(''); setSaved(Boolean(record))
  }

  function selectPack(record: StudioPack) {
    openEditor(record)
    const layer = navigationLayer(history.state)
    if (layer?.studio !== 'pack' || layer.studioPack !== record.draft.id)
      pushLayer(location.pathname, { studio: 'pack', studioPack: record.draft.id })
  }

  function closeEditor() {
    const layer = navigationLayer(history.state)
    if (layer?.studio === 'pack' || layer?.studio === 'trial') history.back()
    else openEditor(undefined)
  }

  function leaveTrial() {
    if (navigationLayer(history.state)?.studio === 'trial') history.back()
    else setTrial(undefined)
  }

  function create(data: PackDraftData) {
    const id = randomId()
    const seen = new Set<string>()
    const chapters = (data.chapters.length ? data.chapters : [game.createPack(data.title).chapters[0]]).map(chapter => {
      let chapterId = chapter.id || newChapterId()
      while (seen.has(chapterId)) chapterId = newChapterId()
      seen.add(chapterId)
      return { ...chapter, id: chapterId,
        puzzles: chapter.puzzles.map(puzzle => ({ ...puzzle, levelId: newLevelId(id), levelRevision: undefined })) }
    })
    const record = wrap({ id, version: 0, published: null, visible: false, data: { ...data, chapters } }, true)
    selectPack(record); persist(record)
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
    const chapter = item?.draft.data.chapters.find(entry => entry.id === selectedChapter?.id)
    if (!item || !chapter || chapter.puzzles.length >= packLevelLimit) return
    const levelId = newLevelId(item.draft.id)
    edit(data => ({ ...data, chapters: data.chapters.map(entry => {
      if (entry.id !== chapter.id) return entry
      const puzzles = [...entry.puzzles]
      puzzles.splice(after === undefined ? puzzles.length : after + 1, 0, { ...game.createLevel(t, input), levelId })
      return { ...entry, puzzles }
    }) }))
    setLevelId(levelId); setTab('levels'); setShowLevelList(false)
  }

  function move(index: number, target: number) {
    if (!selectedChapter) return
    editChapter(selectedChapter.id, chapter => {
      const puzzles = [...chapter.puzzles]
      const [item] = puzzles.splice(index, 1)
      puzzles.splice(target, 0, item)
      return { ...chapter, puzzles }
    })
  }

  function addChapter() {
    const item = active.current
    if (!item || item.draft.data.chapters.length >= packChapterLimit) return
    const source = item.draft.data.chapters[0]
    if (!source) return
    const chapter: Chapter = {
      id: newChapterId(), title: t('Chapter {number}', { number: item.draft.data.chapters.length + 1 }),
      description: '', theme: source.theme, rules: source.rules, puzzles: [],
    }
    edit(data => ({ ...data, chapters: [...data.chapters, chapter] }))
    setChapterId(chapter.id); setLevelId(undefined); setTab('levels')
  }

  function moveChapter(index: number, target: number) {
    if (target < 0) return
    edit(data => {
      const chapters = [...data.chapters]
      if (target >= chapters.length) return data
      const [item] = chapters.splice(index, 1)
      chapters.splice(target, 0, item)
      return { ...data, chapters }
    })
  }

  function removeChapter(id: string) {
    const chapters = active.current?.draft.data.chapters
    if (!chapters || chapters.length <= 1) return
    const index = chapters.findIndex(chapter => chapter.id === id)
    if (index < 0 || !window.confirm(t('Remove {title} from this pack draft?', { title: chapters[index].title }))) return
    edit(data => ({ ...data, chapters: data.chapters.filter(chapter => chapter.id !== id) }))
    if (chapterId === id) {
      const next = chapters[index + 1] ?? chapters[index - 1]
      setChapterId(next.id); setLevelId(next.puzzles[0]?.levelId)
    }
  }

  const feedback = problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>
  if (!selected) return <section className="pack-workspace">
    <div className="section-heading"><div>
      <button className="text-button" onClick={leave}><ArrowLeft size={17}/> {admin ? t('Administration') : leaveLabel}</button>
      <h1>{admin ? t('Edit as admin') : t('My packs')}</h1>
      <p>{admin ? t('Choose a creator’s pack to open its shared draft.') : t('Create a pack of chapters, then build each chapter’s trail one puzzle at a time.')}</p></div>
      {!admin && online && <label className="secondary file-label"><Upload size={16}/> {t('Import pack')}
        <input type="file" aria-label={t('Import pack')} accept=".aviarium-pack,.zip" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) task(async () => {
            if (file.size > packUploadBytes) throw new Error('This pack exceeds the upload limit.')
            const content = (await readFile(file)).split(',', 2)[1]
            const record = wrap(await api<PackDraft>(draftUrl + '/import', json('POST', { content }), account.id))
            await db.studioPacks.put(record); selectPack(record)
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
          const copyTitle = game.presentation.title(t, pack)
          setChecks(current => ({
            ...current,
            ...Object.fromEntries(pack.data.chapters.flatMap(chapter =>
              chapter.puzzles.map(item => [game.checkKey(item, chapter.rules), game.verified(item)]))),
          }))
          create({ ...pack.data, title: t('{title} (test copy)', { title: copyTitle }).slice(0, 80),
            description: game.presentation.description(t, pack) })
        }}>{t('Make test copy')}</button>
      </li>)}</ul>
    </section>}
    <ul className="studio-pack-list">{records.map(record => <li className="panel padded" key={record.key}>
      <div><h2>{record.draft.data.title}</h2>
        <p>{[record.draft.ownerName, record.draft.visible && record.draft.published ? t('Live revision {revision}', { revision: record.draft.published })
          : record.draft.published ? t('Unpublished') : t('Draft'),
          t('{count, plural, one {# chapter} other {# chapters}}', { count: record.draft.data.chapters.length }),
          record.dirty ? t('Changes on this device') : t('Draft saved online')].filter(Boolean).join(' · ')}</p></div>
      <button className="secondary" onClick={() => selectPack(record)}>{admin ? t('Edit as admin') : t('Open pack')}</button>
    </li>)}</ul>
  </section>

  const { draft, dirty } = selected
  const selectedKey = selected.key
  const syncConflict = conflict || remoteConflicts.has(selected.key)
  const data = draft.data
  const chapters = data.chapters
  const chapter = chapters.find(item => item.id === selectedChapter?.id) ?? chapters[0]
  const puzzle = chapter?.puzzles.find(item => item.levelId === levelId)
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
      closeEditor(); onPublish()
    })
  }

  const previous = livePack?.id === draft.id && livePack.revision === draft.published ? livePack : undefined
  const beforeLevel = previous ? packLevels(game.id, previous) : []
  const checkAt = (item: ChapterPuzzle, rules: Chapter['rules']) => {
    const key = game.checkKey(item, rules)
    const prior = previous?.data.chapters.flatMap(chapter => chapter.puzzles.map(entry => ({ entry, rules: chapter.rules })))
      .find(({ entry, rules: priorRules }) => entry.levelId === item.levelId && game.checkKey(entry, priorRules) === key)
    return checks[key] ?? (prior ? game.verified(prior.entry) : undefined)
  }
  const preview: PublishedPack = { id: draft.id, revision: (draft.published ?? 0) + 1, builtIn: false,
    history: previous ? [...(previous.history ?? []), ...(previous.history?.some(path => path.revision === previous.revision) ? [] : [packProgressPath(previous)])] : [],
    data: { ...data, chapters: data.chapters.map(chapter => ({ ...chapter,
      puzzles: chapter.puzzles.map(item => game.preview(item, chapter.rules, checkAt(item, chapter.rules))) })) } }
  preview.data.chapters = assignPackLevels(preview, previous, game.sameLevel) ?? preview.data.chapters
  const currentPuzzles = data.chapters.flatMap(chapter => chapter.puzzles.map(item => ({ item, rules: chapter.rules })))
  const currentIds = new Set(currentPuzzles.map(({ item }) => item.levelId ?? ''))
  const oldRetained = beforeLevel.filter(old => currentIds.has(old.id)).map(level => level.id)
  const newRetained = currentPuzzles.filter(({ item }) => oldRetained.includes(item.levelId ?? '')).map(({ item }) => item.levelId)
  const reviews = new Map(currentPuzzles.map(({ item, rules }) => [item.levelId, checkAt(item, rules)]))
  const details = new Map(currentPuzzles.flatMap(({ item, rules }) => {
    const detail = reviews.get(item.levelId)?.detail
    return item.levelId ? [[item.levelId, detail && t(detail)] as const] : []
  }))
  const removedLevels = beforeLevel.filter(level => !currentIds.has(level.id))
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
    const layer = navigationLayer(history.state)
    if (layer?.studio !== 'trial') {
      if (layer?.studio !== 'pack')
        pushLayer(location.pathname, { studio: 'pack', studioPack: draft.id })
      pushLayer(location.pathname, { studio: 'trial', studioPack: draft.id })
    }
    setTrial({ level, pack: preview })
  }

  if (trial) {
    const trialLocation = trial.level.pack ? packStopAt(trial.pack, trial.level.pack.stop) : undefined
    return <div className={'app studio-preview studio-test-play' + (mode === 'reader' ? ' reader' : '')}
      data-theme={mode === 'dark' ? 'dark' : 'light'}>
      <div className={`game-theme ${game.theme} pack-${trialLocation?.chapter.theme ?? trial.pack.data.chapters[0]?.theme ?? 'default'} pack-palette studio-pack-preview`}>
        <p className="notice">{t('Test play · progress stays in this preview')}</p>
        <game.Trial key={trial.level.id} {...trial} profile={account.id} reader={mode === 'reader'} leave={leaveTrial}/>
      </div>
    </div>
  }

  const canPublish = data.chapters.length > 0 && Boolean(data.title.trim()) &&
    data.chapters.every(chapter => chapter.title.trim() && chapter.puzzles.length > 0) &&
    currentPuzzles.every(({ item, rules }) => item.title.trim() && checkAt(item, rules)?.ready)
  const tabs = [{ id: 'chapters', title: t('Chapters') }, { id: 'levels', title: t('Levels') },
    { id: 'pack', title: t('Pack') }, { id: 'chapter', title: t('Chapter') }, { id: 'rules', title: t('Rules') },
    { id: 'preview', title: t('Preview') }]
  function chooseLevel(id: string | undefined) { setLevelId(id); setTab('levels'); setShowLevelList(false) }
  function chooseChapter(id: string) {
    const next = chapters.find(item => item.id === id)
    setChapterId(id); setLevelId(next?.puzzles[0]?.levelId)
    if (tab !== 'chapter' && tab !== 'rules') setTab('levels')
    setShowLevelList(false)
  }
  const chapterSelect = chapters.length > 1 ? <label className="studio-chapter-select">{t('Chapter')}
    <select value={chapter?.id ?? ''} onChange={event => chooseChapter(event.target.value)}>
      {chapters.map((item, index) => <option key={item.id} value={item.id}>
        {index + 1}. {item.title || t('Untitled chapter')}
      </option>)}
    </select>
  </label> : null

  const sidebar = tab === 'levels' && chapter ? <>
    <div className="section-heading"><h2 className="studio-level-heading">{t('Levels')}</h2>
      <button className="secondary studio-toggle-levels" aria-expanded={showLevelList} onClick={() => setShowLevelList(!showLevelList)}>
        {puzzle ? t('Levels · {position} of {total}', {
          position: chapter.puzzles.indexOf(puzzle) + 1, total: chapter.puzzles.length,
        }) : t('Levels')}
      </button>
      <button className="secondary" disabled={busy || chapter.puzzles.length >= packLevelLimit} onClick={() => add()}><Plus size={16}/> {t('Add level')}</button>
    </div>
    {chapterSelect}
    <div className={'studio-level-panel' + (showLevelList ? ' is-open' : '')}>
      <PackLevelList levels={chapter.puzzles.map(item => {
        const detail = checkAt(item, chapter.rules)?.detail
        return { id: item.levelId!, title: item.title || t('Untitled puzzle'),
          detail: [detail ? t(detail) : t('Ungraded')].filter(Boolean).join(' · ') }
      })} selected={levelId} disabled={busy} canInsert={chapter.puzzles.length < packLevelLimit}
        select={chooseLevel} move={move} insert={index => add(undefined, index)} remove={id => {
          const index = chapter.puzzles.findIndex(item => item.levelId === id)
          if (!window.confirm(t('Remove {title} from this pack draft?', { title: chapter.puzzles[index].title }))) return
          editChapter(chapter.id, current => ({ ...current, puzzles: current.puzzles.filter(item => item.levelId !== id) }))
          if (id === levelId) setLevelId(chapter.puzzles[index + 1]?.levelId ?? chapter.puzzles[index - 1]?.levelId)
        }}/>
    </div>
    {chapter.puzzles.length === packLevelLimit && <p>{t('Add up to 30 puzzles per chapter.')}</p>}
    {legacy.length > 0 && <label>{t('Bring in a saved puzzle')}<select value="" disabled={busy || chapter.puzzles.length >= packLevelLimit} onChange={event => {
      const item = legacy.find(draft => draft.levelId === event.target.value)
      if (item) add(item)
    }}><option value="">{t('Saved drafts')}</option>{legacy.map(item => <option key={item.levelId} value={item.levelId}>{item.title}</option>)}</select></label>}
  </> : undefined

  return <PackWorkspace title={data.title || t('Untitled pack')} sections={tabs} active={tab} choose={setTab} sidebar={sidebar}
    navigation={<button className="text-button studio-pack-back" onClick={closeEditor} disabled={busy}><ArrowLeft size={17}/> {admin ? t('Edit as admin') : t('My packs')}</button>}
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
          openEditor(next)
        })
      }}>{t('Open synced version')}</button>
    </div>}
    <fieldset className="studio-fields" disabled={busy}>
      {tab === 'chapters' && <div className="panel padded studio-chapters">
        <div className="section-heading"><div><h2>{t('Chapters')}</h2>
          <p>{t('Levels are grouped into chapters. Players choose a chapter before its trail.')}</p></div>
          <button className="secondary" type="button" disabled={busy || chapters.length >= packChapterLimit} onClick={addChapter}>
            <Plus size={16}/> {t('Add chapter')}
          </button></div>
        {chapters.length === packChapterLimit && <p>{t('Add up to 12 chapters per pack.')}</p>}
        <div className="chapter-cards studio-chapter-cards">{chapters.map((item, index) => {
          const art = item.cover ?? item.background
          const ready = item.puzzles.filter(puzzle => checkAt(puzzle, item.rules)?.ready).length
          return <article className={`chapter-card pack-${item.theme}`} key={item.id}>
            <span className="chapter-card-art">
              {art ? <img className="chapter-cover" src={art} alt=""/> : <span className="chapter-cover chapter-cover-empty"/>}
              <span className="chapter-number">{index + 1}</span>
            </span>
            <span className="chapter-card-body">
              <span className="eyebrow">{t('Chapter {number}', { number: index + 1 })}</span>
              <span className="chapter-card-title">{item.title || t('Untitled chapter')}</span>
              {item.description && <span className="chapter-card-description">{item.description}</span>}
              <span className="chapter-card-progress">{t('{solved} of {total} levels checked', { solved: ready, total: item.puzzles.length })}</span>
              <span className="button-bar studio-chapter-actions">
                <button className="secondary" type="button" disabled={busy}
                  onClick={() => chooseChapter(item.id)}>{t('Open chapter')}</button>
                <button className="secondary" type="button" disabled={busy}
                  onClick={() => { chooseChapter(item.id); setTab('chapter') }}>{t('Chapter settings')}</button>
                <button className="icon-button" type="button" disabled={busy || index === 0}
                  aria-label={t('Move {title} up', { title: item.title })} title={t('Move up')}
                  onClick={() => moveChapter(index, index - 1)}><ArrowUp size={16}/></button>
                <button className="icon-button" type="button" disabled={busy || index === chapters.length - 1}
                  aria-label={t('Move {title} down', { title: item.title })} title={t('Move down')}
                  onClick={() => moveChapter(index, index + 1)}><ArrowDown size={16}/></button>
                <button className="icon-button" type="button" disabled={busy || chapters.length <= 1}
                  aria-label={t('Remove {title}', { title: item.title })} title={t('Remove chapter')}
                  onClick={() => removeChapter(item.id)}><Trash2 size={16}/></button>
              </span>
            </span>
          </article>
        })}</div>
      </div>}

      {tab === 'levels' && (puzzle && chapter ? <game.Editor key={puzzle.levelId} level={puzzle} rules={chapter.rules} onCheck={onCheck}
        update={patch => editChapter(chapter.id, current => ({ ...current,
          puzzles: current.puzzles.map(item => item.levelId === puzzle.levelId ? { ...item, ...patch } : item) }))}
        trial={() => {
          const level = packLevels(game.id, preview).find(item => item.id === puzzle.levelId)
          if (level) startTrial(level)
        }}/> : <p className="empty">{chapter ? t('Add a level to open the level editor.') : t('Add a chapter to start building.')}</p>)}

      {tab === 'pack' && <div className="panel padded pack-form studio-pack-fields">
        <h2>{t('Pack settings')}</h2>
        <p>{t('These settings describe the whole pack. Chapters have their own settings.')}</p>
        <label>{t('Pack title')}<input value={data.title} maxLength={80} onChange={event => edit(current => ({ ...current, title: event.target.value }))}/></label>
        <label>{t('Description')}<textarea aria-label={t('Description')} rows={3} value={data.description} maxLength={420}
          onChange={event => edit(current => ({ ...current, description: event.target.value }))}/></label>
        <div className="pack-art-inputs"><div>
          {data.cover && <img alt="" src={data.cover}/>}
          <label>{t('Pack cover')}<input type="file" aria-label={t('Pack cover')}
            accept="image/png,image/jpeg,image/webp" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ''
              if (file) task(async () => { const image = await packArtwork(file); edit(current => ({ ...current, cover: image })) })
            }}/></label>
          {data.cover && <button className="text-button" type="button" onClick={() => edit(current => ({ ...current, cover: undefined }))}>{t('Remove')}</button>}
        </div></div>
      </div>}

      {tab === 'chapter' && chapter && <div className="panel padded pack-form studio-chapter-fields">
        <h2>{t('Chapter settings')}</h2>
        {chapterSelect}
        <label>{t('Chapter title')}<input value={chapter.title} maxLength={80} onChange={event => editChapter(chapter.id,
          current => ({ ...current, title: event.target.value }))}/></label>
        <label>{t('Chapter description')}<textarea aria-label={t('Chapter description')} rows={3} value={chapter.description} maxLength={420}
          onChange={event => editChapter(chapter.id, current => ({ ...current, description: event.target.value }))}/></label>
        <fieldset className="studio-theme-picker"><legend>{t('Theme')}</legend>
          <div className="studio-theme-options">
            {game.themes.map(({ id, name }) => <label key={id} className="studio-theme-option">
              <input type="radio" name="chapter-theme" value={id} checked={chapter.theme === id}
                onChange={() => editChapter(chapter.id, current => ({ ...current, theme: id }))}/>
              <span className="studio-theme-name">{t(name)}{chapter.theme === id && <Check size={16} aria-hidden="true"/>}</span>
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
            <p>{t('E-reader displays the chapter in grayscale.')}</p>
          </div>
        </fieldset>
        <div className="pack-art-inputs">{(['cover', 'background'] as const).map(key => <div key={key}>
          {chapter[key] && <img alt="" src={chapter[key]}/>}
          <label>{key === 'cover' ? t('Chapter cover image') : t('Chapter background image')}
            <input type="file" aria-label={key === 'cover' ? t('Chapter cover image') : t('Chapter background image')}
              accept="image/png,image/jpeg,image/webp" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = ''
              if (file) task(async () => {
                const image = await packArtwork(file)
                editChapter(chapter.id, current => ({ ...current, [key]: image }))
              })
            }}/></label>
          {chapter[key] && <button className="text-button" type="button" onClick={() => editChapter(chapter.id,
            current => ({ ...current, [key]: undefined }))}>{t('Remove')}</button>}
        </div>)}</div>
      </div>}

      {tab === 'rules' && chapter && <div className="panel padded pack-form"><h2>{t('Chapter rules')}</h2>
        {chapterSelect}
        <p>{t('Levels use these rules unless you override them in the level editor.')}</p>
        <StudioRuleFields values={chapter.rules} groups={game.rules}
          update={patch => editChapter(chapter.id, current => ({ ...current, rules: { ...current.rules, ...patch } }))}/>
      </div>}

      {tab === 'review' && <div className="panel padded pack-form studio-review">
        <h2>{t(draft.visible ? 'Publish update' : 'Publish pack')}</h2>
        <p>{t(draft.visible ? 'This replaces the current version in the {game} catalog on this instance.'
          : 'This makes the pack available to players in the {game} catalog on this instance.', { game: game.title })}</p>
        {!data.title.trim() && <button className="text-button" onClick={() => setTab('pack')}>{t('Enter a pack title')}</button>}
        {data.chapters.map((item, chapterIndex) => <section key={item.id} className="studio-review-chapter">
          <h3>{t('Chapter {number}', { number: chapterIndex + 1 })}: {item.title || t('Untitled chapter')}</h3>
          {!item.title.trim() && <button className="text-button" onClick={() => { chooseChapter(item.id); setTab('chapter') }}>{t('Enter a chapter title')}</button>}
          {!item.puzzles.length && <p>{t('Add at least one level to this chapter.')}</p>}
          <ul>{item.puzzles.map((entry, index) => {
            const oldIndex = beforeLevel.findIndex(level => level.id === entry.levelId)
            const previewEntry = preview.data.chapters.find(previewChapter => previewChapter.id === item.id)?.puzzles[index]
            const changed = previewEntry?.levelRevision === preview.revision
            const result = checkAt(entry, item.rules)
            const status = result ? t(result.detail ?? result.status) : t('Checking puzzle…')
            const moved = oldIndex >= 0 && oldRetained.indexOf(entry.levelId ?? '') !== newRetained.indexOf(entry.levelId)
            return <li key={entry.levelId}>
              <button className="text-button" onClick={() => { chooseChapter(item.id); chooseLevel(entry.levelId) }}>{index + 1}. {entry.title || t('Untitled puzzle')}</button>
              <span>{[!entry.title.trim() ? t('Enter a puzzle title') : status, previous &&
                (oldIndex < 0 ? t('Added') : changed ? t('Changed') : undefined),
                moved && t('Moved')].filter(Boolean).join(' · ')}</span>
            </li>
          })}
          </ul>
        </section>)}
        {removedLevels.length > 0 && <section className="studio-review-chapter">
          <h3>{t('Removed levels')}</h3>
          <ul>{removedLevels.map(old => <li key={old.id}><span>{old.title} · {t('Removed')}</span></li>)}</ul>
        </section>}
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
          {chapter && <button className="text-button" type="button" onClick={() => {
            const trail = trailPreview.current
            trail?.scrollTo({ top: trail.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
          }}>{t('Show chapter start')}</button>}
        </div>
        {previous && <div className="button-bar">
          <button className="text-button" aria-pressed={!returning} onClick={() => setReturning(false)}>{t('New player')}</button>
          <button className="text-button" aria-pressed={returning} onClick={() => setReturning(true)}>{t('Returning player')}</button>
        </div>}
        <div ref={trailPreview} className={'app studio-preview studio-trail-preview' + (mode === 'reader' ? ' reader' : '')}
          data-theme={mode === 'dark' ? 'dark' : 'light'} role="region" aria-label={t('Pack preview')} tabIndex={0}>
          <div className={`game-theme ${game.theme} pack-${data.chapters[0]?.theme ?? 'default'} studio-pack-preview`}>
            <PackChapters presentation={game.presentation} pack={preview} completed={new Set()} sessions={[]}
              canExport={false} leave={() => setTab('levels')} preview
              previewCompletions={returning ? returningCompletions : undefined}/>
            {chapter && <PackRoadmap game={game.id} presentation={game.presentation} pack={preview} chapterId={chapter.id}
              completed={new Set()} previewCompletions={returning ? returningCompletions : undefined} sessions={[]}
              canExport={false} canPlay preview previewDetails={details} leave={() => setTab('levels')} play={startTrial}/>}
          </div>
        </div>
      </>}
    </fieldset>
    {Boolean(draft.published) && online && tab === 'preview' && <div className="button-bar">
      <a className="secondary" href={packExportUrl({ id: draft.id, revision: draft.published!, data })} download><Download size={16}/> {t('Export pack')}</a>
    </div>}
  </PackWorkspace>
}
