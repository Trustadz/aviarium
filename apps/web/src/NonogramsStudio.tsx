import { useLayoutEffect, type CSSProperties } from 'react'
import {
  createNonogramAttempt, gridSizeSchema, nonogramPacks, nonogramsId, sameNonogramLevel,
  type NonogramEntry, type NonogramLevel,
} from '../../../packages/nonograms/src/contracts.js'
import { fromPicture, randomSizes, solveByDeduction } from '../../../packages/nonograms/src/puzzles.js'
import type { LevelReview, StudioEditorProps, StudioGame, StudioTrialProps } from './game-studio.js'
import { useT } from './i18n.js'
import Nonograms from './Nonograms.js'
import { nonogramPresentation } from './nonograms-web.js'
import PackStudio, { type PackStudioProps } from './PackStudio.js'

function blank(size: number) {
  return Array<string>(size).fill('.'.repeat(size))
}

function review(entry: NonogramEntry): LevelReview {
  return entry.content.rows.some(runs => runs[0] > 0) && solveByDeduction(entry.content)
    ? { ready: true, status: 'Valid · unique solution' }
    : { ready: false, status: 'A nonogram must be solvable by deduction.' }
}

const checkKey = (entry: NonogramEntry) => JSON.stringify(entry.content)

function Editor({ level, update, trial, onCheck }: StudioEditorProps) {
  const t = useT()
  const entry = level as NonogramEntry
  const key = checkKey(entry)
  const { ready, status } = review(entry)
  useLayoutEffect(() => onCheck(key, { ready, status }), [key, onCheck, ready, status])
  const size = entry.content.rows.length
  const solution = entry.picture ? undefined : solveByDeduction(entry.content)?.cells
  const picture = entry.picture ?? (solution ? Array.from({ length: size }, (_, row) =>
    solution.slice(row * size, (row + 1) * size).map(cell => cell === 1 ? '#' : '.').join('')) : blank(size))

  function draw(pixels: string[]) {
    const patch = { ruleset: 1 as const, content: fromPicture(pixels), picture: pixels }
    update(patch)
  }

  return <div className="panel padded pack-form">
    <label>{t('Puzzle title')}<input maxLength={100} value={entry.title}
      onChange={event => update({ title: event.target.value })}/></label>
    <label>{t('Grid size')}<select value={size} onChange={event => {
      const next = gridSizeSchema.parse(Number(event.target.value))
      if (picture.some(row => row.includes('#')) && !window.confirm(t('Changing the grid size clears the drawing. Continue?'))) return
      draw(blank(next))
    }}>
      {randomSizes.map(value => <option key={value} value={value}>{value} × {value}</option>)}
    </select></label>
    <h2>{t('Draw the puzzle')}</h2>
    <div className="nonogram-editor" role="group" aria-label={t('Draw the puzzle')}
      style={{ '--columns': size } as CSSProperties}>
      {picture.flatMap((line, row) => Array.from(line, (pixel, column) => {
        const filled = pixel === '#'
        return <button key={row * size + column} type="button" className="nonogram-cell"
          data-mark={filled ? 1 : 0} aria-pressed={filled}
          aria-label={t('Row {row}, column {column}', { row: row + 1, column: column + 1 })}
          onClick={() => draw(picture.map((text, index) =>
            index === row ? text.slice(0, column) + (filled ? '.' : '#') + text.slice(column + 1) : text))}/>
      }))}
    </div>
    <p role="status">{t(status)}</p>
    <button type="button" className="secondary" disabled={!ready} onClick={trial}>{t('Test play')}</button>
  </div>
}

function Trial({ level, pack, profile, reader, leave }: StudioTrialProps) {
  const session = { id: level.id, revision: 0, data: createNonogramAttempt(level as NonogramLevel, pack),
    profile, updated: Date.now(), archived: false, dirty: false }
  return <Nonograms level={level} pack={pack} session={session} trial testMode
    preferences={{}} reader={reader} persist={async () => {}} leave={leave} restart={leave}/>
}

const studioGame: StudioGame = {
  id: nonogramsId, title: 'Nonograms', theme: 'nonogram-theme',
  themes: [{ id: 'default', name: 'Game default' }, { id: 'cockatoos', name: 'Cockatoo sky' }],
  rules: [{ label: 'Roadmap', fields: [{ key: 'inOrder', label: 'In order', kind: 'switch' }] }],
  presentation: nonogramPresentation,
  createPack: title => ({ format: 1, game: nonogramsId, title, description: '', theme: 'default', rules: { inOrder: true }, puzzles: [] }),
  createLevel(t, previous) {
    const picture = blank(5)
    const entry: NonogramEntry = previous
      ? { ...(previous as NonogramEntry), levelId: undefined, levelRevision: undefined }
      : { title: t('Untitled puzzle'), ruleset: 1, content: fromPicture(picture), picture }
    return entry
  },
  accepts: input => nonogramPacks.draft.safeParse(input).success,
  sameLevel: (entry, _rules, previous) => sameNonogramLevel(entry as NonogramEntry, previous as NonogramEntry),
  checkKey: entry => checkKey(entry as NonogramEntry),
  check: async entry => review(entry as NonogramEntry),
  verified: () => ({ ready: true, status: 'Valid · unique solution' }),
  preview: entry => entry,
  Editor,
  Trial,
}

export default function NonogramsStudio(props: PackStudioProps) {
  return <PackStudio {...props} game={studioGame}/>
}
