import { unzipSync, zipSync } from 'fflate'
import { authoringPack, maxPackManifestBytes, packImageBytes, packUploadBytes, upgradePackDocument,
  type PackDocument } from '../../../packages/game-sdk/src/packs.js'
import type { GamePacks } from './game-runtime.js'
import { HttpError } from './auth.js'

const assetTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
type AssetExtension = keyof typeof assetTypes
const artworkName = /^(?:(cover|background)|chapters\/([a-z0-9-]{1,64})\/(cover|background))\.(png|jpg|webp)$/

function readImage(image: string) {
  const [prefix, content] = image.split(',', 2)
  const bytes = Buffer.from(content, 'base64')
  const extension = (Object.keys(assetTypes) as AssetExtension[]).find(ext => prefix === 'data:' + assetTypes[ext] + ';base64')
  const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : extension === 'jpg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      : extension === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!extension || bytes.length > packImageBytes || !valid)
    throw new HttpError(422, 'pack_art_invalid')
  return { bytes, extension }
}

export function readPackDraft(game: GamePacks, input: unknown) {
  const draft = game.readDraft(upgradePackDocument(input))
  if (draft.cover) readImage(draft.cover)
  for (const chapter of draft.chapters) {
    if (chapter.cover) readImage(chapter.cover)
    if (chapter.background) readImage(chapter.background)
  }
  const data = authoringPack(draft)
  packManifest(game, data)
  return data
}

export function packManifest(game: GamePacks, data: PackDocument) {
  const manifest = Buffer.from(JSON.stringify(game.readManifest(data)))
  if (manifest.length > maxPackManifestBytes) throw new HttpError(413, 'pack_upload_limit')
  return manifest
}

function addImage(files: Record<string, Uint8Array>, path: string, image: string) {
  const { bytes, extension } = readImage(image)
  files[path + '.' + extension] = bytes
}

export function exportPack(game: GamePacks, data: PackDocument) {
  const files: Record<string, Uint8Array> = {
    'manifest.json': packManifest(game, data),
  }
  if (data.cover) addImage(files, 'cover', data.cover)
  for (const chapter of data.chapters) {
    if (chapter.cover) addImage(files, 'chapters/' + chapter.id + '/cover', chapter.cover)
    if (chapter.background) addImage(files, 'chapters/' + chapter.id + '/background', chapter.background)
  }
  return Buffer.from(zipSync(files))
}

export function importPack(game: GamePacks, bytes: Uint8Array) {
  if (bytes.length > packUploadBytes) throw new HttpError(413, 'pack_upload_limit')
  let files: Record<string, Uint8Array>
  try {
    const members = new Set<string>()
    files = unzipSync(bytes, { filter(entry) {
      const match = artworkName.exec(entry.name)
      const manifest = entry.name === 'manifest.json'
      const key = manifest ? entry.name : match?.[1] ? match[1] : match ? 'chapters/' + match[2] + '/' + match[3] : entry.name
      if ((!manifest && !match) || members.has(key) ||
          entry.originalSize > (manifest ? maxPackManifestBytes : packImageBytes))
        throw new Error('Invalid ZIP member')
      members.add(key)
      return true
    } })
  } catch {
    throw new HttpError(422, 'pack_archive_invalid')
  }
  let manifest: unknown
  try {
    if (!files['manifest.json']) throw new Error('Missing manifest')
    manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
  } catch {
    throw new HttpError(422, 'pack_manifest_invalid')
  }
  const draft = game.readManifest(upgradePackDocument(manifest))
  const apply = (path: string, image: Uint8Array, extension: AssetExtension) => {
    const data = `data:${assetTypes[extension]};base64,${Buffer.from(image).toString('base64')}`
    if (path === 'cover' || path === 'legacy-background') {
      if (path === 'cover') draft.cover = data
      // A format 1 pack used one cover for the whole pack, so it becomes the
      // singular chapter's image as well as the pack image.
      if (draft.chapters[0] && !draft.chapters[0][path === 'cover' ? 'cover' : 'background'])
        draft.chapters[0][path === 'cover' ? 'cover' : 'background'] = data
      return
    }
    const [, chapterId, key] = /^chapters\/([a-z0-9-]{1,64})\/(cover|background)$/.exec(path) ?? []
    const chapter = draft.chapters.find(item => item.id === chapterId)
    if (chapter && key === 'cover') chapter.cover = data
    if (chapter && key === 'background') chapter.background = data
  }
  for (const name of Object.keys(files)) {
    const match = artworkName.exec(name)
    if (!match) continue
    const path = match[1] ? (match[1] === 'cover' ? 'cover' : 'legacy-background')
      : 'chapters/' + match[2] + '/' + match[3]
    apply(path, files[name], match[4] as AssetExtension)
  }
  return readPackDraft(game, draft)
}
