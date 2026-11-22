import { unzipSync, zipSync } from 'fflate'
import { authoringPack, maxPackManifestBytes, packImageBytes, packUploadBytes, type PackDocument } from '../../../packages/game-sdk/src/packs.js'
import type { GamePacks } from './game-runtime.js'
import { HttpError } from './auth.js'

const assetTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
type AssetExtension = keyof typeof assetTypes

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
  const draft = game.readDraft(input)
  if (draft.cover) readImage(draft.cover)
  if (draft.background) readImage(draft.background)
  const data = authoringPack(draft)
  packManifest(game, data)
  return data
}

const artwork = ['cover', 'background'] as const

export function packManifest(game: GamePacks, data: PackDocument) {
  const manifest = Buffer.from(JSON.stringify(game.readManifest(data)))
  if (manifest.length > maxPackManifestBytes) throw new HttpError(413, 'pack_upload_limit')
  return manifest
}

export function exportPack(game: GamePacks, data: PackDocument) {
  const files: Record<string, Uint8Array> = {
    'manifest.json': packManifest(game, data),
  }
  for (const key of artwork) {
    const image = data[key]
    if (image) {
      const { bytes, extension } = readImage(image)
      files[key + '.' + extension] = bytes
    }
  }
  return Buffer.from(zipSync(files))
}

export function importPack(game: GamePacks, bytes: Uint8Array) {
  if (bytes.length > packUploadBytes) throw new HttpError(413, 'pack_upload_limit')
  let files: Record<string, Uint8Array>
  try {
    const members = new Set<string>()
    files = unzipSync(bytes, { filter(entry) {
      const match = /^(cover|background)\.(png|jpg|webp)$/.exec(entry.name)
      const manifest = entry.name === 'manifest.json'
      const key = match?.[1] ?? entry.name
      if ((!manifest && !match) || members.has(key) || entry.originalSize > (manifest ? maxPackManifestBytes : packImageBytes))
        throw new Error('Invalid ZIP member')
      members.add(key)
      return true
    } })
  } catch {
    throw new HttpError(422, 'pack_archive_invalid')
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
  } catch {
    throw new HttpError(422, 'pack_manifest_invalid')
  }
  const draft = game.readManifest(manifest)
  for (const key of artwork) {
    for (const extension of Object.keys(assetTypes) as AssetExtension[]) {
      const image = files[key + '.' + extension]
      if (image) draft[key] = `data:${assetTypes[extension]};base64,${Buffer.from(image).toString('base64')}`
    }
  }
  return readPackDraft(game, draft)
}
