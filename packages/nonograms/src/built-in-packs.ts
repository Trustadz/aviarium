import type { PackDocument } from '../../game-sdk/src/packs.js'
import { nonogramsId } from './contracts.js'
import { starterPack } from './puzzles.js'

/** The built-in cockatoo pack, shared by the server game and the game adapter. */
export const nonogramBuiltInPacks: readonly { id: string; revision: number; coverFile?: string; data: PackDocument }[] = [{
  id: 'nonograms-' + starterPack.id, revision: starterPack.revision, coverFile: 'cockatoos-portrait.webp',
  data: {
    format: 1, game: nonogramsId, title: starterPack.title, description: starterPack.description,
    theme: 'cockatoos', rules: { inOrder: true },
    puzzles: starterPack.puzzles.map(({ id, title, puzzle }) => ({
      levelId: 'nonograms-' + id, title, content: puzzle, ruleset: 1,
    })),
  } as PackDocument,
}]
