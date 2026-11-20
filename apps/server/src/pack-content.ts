import { unzipSync, zipSync } from 'fflate'
import { gradedPackSchema, packDraftSchema, packImageBytes, packManifestSchema, packUploadBytes,
  type GradedPack, type PackDraftData } from '../../../packages/sudoku/src/packs.js'
import { gradePuzzle } from '../../../packages/sudoku/src/logic.js'
import { validate } from '../../../packages/sudoku/src/solver.js'
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
    throw new HttpError(422, 'Pack artwork must be a PNG, JPEG, or WebP no larger than 512 KB.')
  return { bytes, extension }
}

export function readPackDraft(input: unknown) {
  const draft = packDraftSchema.parse(input)
  if (draft.cover) readImage(draft.cover)
  if (draft.background) readImage(draft.background)
  return draft
}

export function gradePack(draft: PackDraftData): GradedPack {
  if (!draft.puzzles.length) throw new HttpError(422, 'Add at least one puzzle before publishing.')
  const puzzles = draft.puzzles.map(puzzle => {
    const grid = Array.from(puzzle.grid, Number)
    if (validate(grid, 65_000).kind !== 'unique')
      throw new HttpError(422, `“${puzzle.title}” needs a verified unique solution.`)
    const { difficulty } = gradePuzzle(grid)
    if (!difficulty) throw new HttpError(422, `“${puzzle.title}” needs review. No complete logical solve was found.`)
    return { ...puzzle, difficulty }
  })
  return gradedPackSchema.parse({ ...draft, puzzles })
}

const artwork = ['cover', 'background'] as const
export function exportPack(data: PackDraftData) {
  const files: Record<string, Uint8Array> = {
    'manifest.json': Buffer.from(JSON.stringify(packManifestSchema.parse(data), null, 2)),
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

export function importPack(bytes: Uint8Array) {
  if (bytes.length > packUploadBytes) throw new HttpError(413, 'This pack exceeds the upload limit.')
  let files: Record<string, Uint8Array>
  try {
    const members = new Set<string>()
    files = unzipSync(bytes, { filter(entry) {
      const match = /^(cover|background)\.(png|jpg|webp)$/.exec(entry.name)
      const manifest = entry.name === 'manifest.json'
      const key = match?.[1] ?? entry.name
      if ((!manifest && !match) || members.has(key) || entry.originalSize > (manifest ? 32_768 : packImageBytes))
        throw new Error('Invalid ZIP member')
      members.add(key)
      return true
    } })
  } catch {
    throw new HttpError(422, 'This file is not a valid Aviarium pack archive.')
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
  } catch {
    throw new HttpError(422, 'The pack manifest is missing or malformed.')
  }
  const draft: PackDraftData = packManifestSchema.parse(manifest)
  for (const key of artwork) {
    for (const extension of Object.keys(assetTypes) as AssetExtension[]) {
      const image = files[key + '.' + extension]
      if (image) draft[key] = `data:${assetTypes[extension]};base64,${Buffer.from(image).toString('base64')}`
    }
  }
  return readPackDraft(draft)
}
