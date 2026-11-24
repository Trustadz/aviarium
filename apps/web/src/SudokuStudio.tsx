import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { useCallback, useState } from 'react'
import type { PackEntry, ProgressionRules } from '../../../packages/game-sdk/src/packs.js'
import { sudoku } from '../../../packages/sudoku/src/metadata.js'
import { defaults } from '../../../packages/sudoku/src/contracts.js'
import { packDraftSchema, packRuleset, sameSudokuLevel, type GradedPack, type PackDraftData, type PackRules, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { api } from './api.js'
import type { LevelReview, StudioEditorProps, StudioGame, StudioTrialProps } from './game-studio.js'
import PackStudio, { type PackStudioProps } from './PackStudio.js'
import Player, { createSave } from './Player.js'
import { sudokuPackPresentation } from './SudokuMenu.js'
import { randomId } from './random.js'
import { SudokuLevelEditor, type StudioCheck } from './SudokuLevelEditor.js'
import { sudokuRuleGroups } from './sudoku-studio-rules.js'
import checkWorkerUrl from './studio-check-worker.ts?worker&url'

type Puzzle = PackDraftData['puzzles'][number]
const blank = '0'.repeat(81)
const emptyRules: PackRules = { hints: true, autoNotes: true, inOrder: true, lives: null, timeTrial: false }

function report(result: StudioCheck): LevelReview {
  return { ready: Boolean(result.difficulty), detail: result.difficulty,
    status: result.kind === 'multiple' ? 'Multiple solutions'
      : result.kind === 'unique' ? 'No supported logical grade found.'
        : result.kind === 'inconclusive' ? 'Verification inconclusive' : 'No valid solution' }
}

function SudokuEditor({ level, rules, update, trial, onCheck }: StudioEditorProps) {
  const checked = useCallback((key: string, result: StudioCheck) => onCheck(key, report(result)), [onCheck])
  return <SudokuLevelEditor puzzle={level as Puzzle} rules={rules as PackRules} update={update} trial={trial} onCheck={checked}/>
}

function SudokuTrial({ level, pack, profile, reader, leave }: StudioTrialProps) {
  const [attempt, reset] = useState(0)
  const [id] = useState(() => randomId())
  const gameLevel = level as PublishedLevel
  const gamePack = pack as PublishedPack
  const session = { id, revision: 0, data: createSave(gameLevel, gamePack), profile,
    updated: Date.now(), archived: false, dirty: false }
  return <Player key={attempt} level={gameLevel} pack={gamePack} session={session} trial testMode
    preferences={defaults} reader={reader} persist={async () => {}} leave={leave} restart={() => reset(value => value + 1)}/>
}

const checkKey = (entry: PackEntry, rules: ProgressionRules) =>
  Number((entry as Puzzle).rules?.diagonal ?? (rules as PackRules).diagonal ?? false) + (entry as Puzzle).grid

const sudokuStudio: StudioGame = {
  id: sudoku.id, title: sudoku.title, theme: 'sudoku-theme',
  themes: [{ id: 'default', name: 'Game default' }, { id: 'meadow', name: 'Meadow' },
    { id: 'twilight', name: 'Twilight' }, { id: 'sunrise', name: 'Sunrise' }],
  rules: sudokuRuleGroups,
  presentation: sudokuPackPresentation,
  createPack: title => ({ format: 1, game: sudoku.id, title, description: '', theme: 'default', rules: emptyRules, puzzles: [] }),
  createLevel(t, previous) {
    const puzzle: Puzzle = { title: previous?.title ?? t('Untitled puzzle'), grid: (previous as Puzzle | undefined)?.grid ?? blank, ruleset: 1 }
    return puzzle
  },
  accepts: input => packDraftSchema.safeParse(input).success,
  sameLevel: (entry, rules, previous, previousRules) =>
    sameSudokuLevel(entry as Puzzle, rules as PackRules, previous as Puzzle, previousRules as PackRules),
  checkKey,
  check(entry, rules, signal) {
    const key = checkKey(entry, rules)
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      const worker = new Worker(checkWorkerUrl)
      const abort = () => { cleanup(); reject(signal.reason) }
      const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<StudioCheck>) => { cleanup(); resolve(report(event.data)) }
      worker.onerror = () => { cleanup(); resolve(report({ kind: 'inconclusive' })) }
      worker.postMessage({ grid: key.slice(1), diagonal: key.startsWith('1') })
    })
  },
  verified(entry) {
    return report({ kind: 'unique', difficulty: (entry as GradedPack['puzzles'][number]).difficulty })
  },
  preview(entry, rules, review) {
    const puzzle = entry as Puzzle
    const difficulty = review?.detail ?? 'Easy'
    return { ...puzzle, ruleset: packRuleset({ ...rules, ...puzzle.rules }), difficulty } as GradedPack['puzzles'][number]
  },
  async legacyDrafts(profile, signal) {
    const drafts = await api<{ id: string; title: string; grid: string }[]>('/drafts', { signal }, profile)
    return drafts.map(({ id, ...draft }) => ({ ...draft, levelId: id, ruleset: 1 }))
  },
  Editor: SudokuEditor,
  Trial: SudokuTrial,
}

export default function SudokuStudio(props: PackStudioProps) {
  return <PackStudio {...props} game={sudokuStudio}/>
}
