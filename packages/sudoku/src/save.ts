import type { PublishedLevel, SudokuSave } from './contracts.js'
import { effectivePackRules, type PublishedPack } from './packs.js'
import { rules } from './rules.js'

/** Create the initial save for a published or generated Sudoku level. */
export function createSave(level: PublishedLevel, pack?: PublishedPack): SudokuSave {
  return {
    game: 'sudoku', level: level.id, levelRevision: level.revision,
    ruleset: level.ruleset === 2 ? 2 : 1, format: 1,
    board: rules.create(Array.from(level.grid, Number)), undo: [], redo: [], elapsedMs: 0, completed: false,
    packRevision: pack?.revision,
    lives: pack && level.pack ? effectivePackRules(pack, level.pack.stop).lives ?? undefined : undefined,
  }
}
