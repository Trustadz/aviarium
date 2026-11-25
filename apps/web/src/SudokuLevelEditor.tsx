import { useEffect, useState } from 'react'
import { Eraser, Play, Sparkles } from 'lucide-react'
import { difficulties, type Difficulty } from '../../../packages/game-sdk/src/index.js'
import type { PackDraftData, PackRules } from '../../../packages/sudoku/src/packs.js'
import { conflicts, parseGrid } from '../../../packages/sudoku/src/rules.js'
import { Grid } from './Grid.js'
import { useT } from './i18n.js'
import { createQuickPlayLevel } from './quick-play.js'
import workerUrl from './studio-check-worker.ts?worker&url'
import { StudioDisclosure } from './StudioDisclosure.js'
import { sudokuRuleGroups } from './sudoku-studio-rules.js'
import { StudioRuleFields } from './StudioRuleFields.js'

type Puzzle = PackDraftData['chapters'][number]['puzzles'][number]
export type StudioCheck = { kind: 'invalid' | 'unsolvable' | 'multiple' | 'unique' | 'inconclusive'; difficulty?: Difficulty }

export function SudokuLevelEditor({ puzzle, rules, update, trial, onCheck }: {
  puzzle: Puzzle; rules: PackRules
  update: (patch: Partial<Puzzle>) => void
  trial: () => void
  onCheck: (key: string, result: StudioCheck) => void
}) {
  const t = useT()
  const [cell, setCell] = useState(0)
  const [tool, setTool] = useState<'manual' | 'paste' | 'generate'>('manual')
  const [previous, setPrevious] = useState<Pick<Puzzle, 'grid' | 'seed' | 'generatorVersion'>>()
  const [paste, setPaste] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy')
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [check, setCheck] = useState<StudioCheck>()
  const entries = Array.from(puzzle.grid, Number)
  const diagonal = puzzle.rules?.diagonal ?? rules.diagonal ?? false
  const errors = conflicts(entries, diagonal)
  useEffect(() => {
    setCheck(undefined)
    let worker: Worker | undefined
    const timer = window.setTimeout(() => {
      worker = new Worker(workerUrl)
      worker.onmessage = (event: MessageEvent<StudioCheck>) => {
        setCheck(event.data)
        onCheck(Number(diagonal) + puzzle.grid, event.data)
        worker?.terminate()
      }
      worker.onerror = () => { setCheck({ kind: 'inconclusive' }); worker?.terminate() }
      worker.postMessage({ grid: puzzle.grid, diagonal })
    }, 300)
    return () => { clearTimeout(timer); worker?.terminate() }
  }, [puzzle.grid, diagonal, onCheck])

  function enter(digit: number) {
    entries[cell] = digit
    replace({ grid: entries.join(''), seed: undefined, generatorVersion: undefined })
  }

  function replace(next: Pick<Puzzle, 'grid' | 'seed' | 'generatorVersion'>) {
    if (next.grid !== puzzle.grid) setPrevious({ grid: puzzle.grid, seed: puzzle.seed, generatorVersion: puzzle.generatorVersion })
    update(next)
  }

  const result = errors.size ? t('Fix the highlighted conflicts.') : !check ? t('Checking puzzle…')
    : check.kind === 'unique' ? check.difficulty ? t('Unique solution · {difficulty}', { difficulty: t(check.difficulty) }) : t('No supported logical grade found.')
      : check.kind === 'multiple' ? t('Multiple solutions') : check.kind === 'inconclusive' ? t('Verification inconclusive')
        : t('No valid solution')

  const overrides = Object.values(puzzle.rules ?? {}).filter(value => value !== undefined).length

  return <section className="studio-level-editor">
    <div className="panel padded studio-level-board">
      <div className="studio-board-toolbar">
        <div className="button-bar">
          <button className="secondary" type="button" aria-expanded={tool === 'paste'} onClick={() => setTool(tool === 'paste' ? 'manual' : 'paste')}>{t('Paste grid')}</button>
          {!diagonal && <button className="secondary" type="button" aria-expanded={tool === 'generate'} onClick={() => setTool(tool === 'generate' ? 'manual' : 'generate')}>{t('Generate')}</button>}
          {previous && <button className="text-button" type="button" disabled={working} onClick={() => { update(previous); setPrevious(undefined) }}>{t('Undo')}</button>}
        </div>
        <div className="studio-board-status"><p role="status">{result}</p>
          <button className="secondary" type="button" disabled={working || check?.kind !== 'unique' || !check.difficulty} onClick={trial}><Play size={17}/> {t('Test play')}</button></div>
      </div>
      {tool === 'paste' && <div className="pack-form studio-paste-fields">
        <label>{t('Grid')}<textarea aria-label={t('Grid')} rows={3} maxLength={300} value={paste} onChange={event => setPaste(event.target.value)}/></label>
        <button className="secondary" type="button" disabled={working} onClick={() => {
          const numbers = parseGrid(paste)
          if (numbers) { replace({ grid: numbers.join(''), seed: undefined, generatorVersion: undefined }); setPaste(''); setNotice(''); setTool('manual') }
          else setNotice(t('Enter 81 digits. Use 0 or a period for blanks.'))
        }}>{t('Use grid')}</button>
      </div>}
      {tool === 'generate' && !diagonal && <div className="pack-form studio-generator">
        <label>{t('Difficulty')}<select value={difficulty} onChange={event => setDifficulty(event.target.value as Difficulty)}>
          {difficulties.map(item => <option key={item} value={item}>{t(item)}</option>)}
        </select></label>
        <button className="secondary" type="button" disabled={working} onClick={() => {
          setWorking(true); setNotice('')
          void createQuickPlayLevel(difficulty).then(level => {
            replace({ grid: level.grid, seed: level.seed ?? undefined, generatorVersion: level.generatorVersion ?? undefined })
            setTool('manual')
          }).catch(() => setNotice(t('Could not prepare a Quick Play puzzle.'))).finally(() => setWorking(false))
        }}><Sparkles size={16}/> {t(working ? 'Working…' : 'Generate puzzle')}</button>
      </div>}
      {notice && <p role="alert">{notice}</p>}
      {diagonal && <p className="studio-variant-label">{t('Diagonal Sudoku')}</p>}
      <Grid diagonal={diagonal} entries={entries} givens={entries} selected={cell} select={setCell} enter={enter} errors={errors} disabled={working}/>
      <div className="studio-digit-pad" aria-label={t('Digits')}>
        {Array.from({ length: 9 }, (_, index) => <button className="secondary" type="button" key={index}
          disabled={working} onClick={() => enter(index + 1)}>{index + 1}</button>)}
        <button className="secondary studio-erase" type="button" disabled={working} aria-label={t('Erase')} onClick={() => enter(0)}><Eraser size={18}/></button>
      </div>
    </div>
    <StudioDisclosure label={t('Level details')} className="panel padded studio-level-properties"
      initiallyOpen={matchMedia('(min-width: 1121px)').matches}>
      <div className="studio-level-fields pack-form">
        <label>{t('Puzzle title')}<input maxLength={100} value={puzzle.title} onChange={event => update({ title: event.target.value })}/></label>
        <label>{t('Level introduction')}<textarea aria-label={t('Level introduction')} rows={3} maxLength={300} value={puzzle.introduction ?? ''}
          onChange={event => update({ introduction: event.target.value })}/></label>
        <StudioDisclosure className="studio-level-rules" label={t('Level rules') + ' · ' + (overrides
          ? t('Overrides: {count}', { count: overrides }) : t('Uses chapter rules'))}>
          <StudioRuleFields values={puzzle.rules ?? {}} defaults={rules} groups={sudokuRuleGroups}
            update={next => update({ rules: next as Partial<PackRules> })}/>
        </StudioDisclosure>
      </div>
    </StudioDisclosure>
  </section>
}
