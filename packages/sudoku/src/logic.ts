import { TACTICS, TACTIC_ID, type GridState, type SolvingStep, type TacticId } from 'sudoku-core'
import type { Difficulty } from '../../game-sdk/src/index.js'
import { bit, candidateMasks, conflicts, diagonals, peerGroups, rulesFor } from './rules.js'

const easy = new Set<TacticId>([TACTIC_ID.OPEN_SINGLES, TACTIC_ID.HIDDEN_SINGLE, TACTIC_ID.NAKED_SINGLE])
const medium = new Set<TacticId>([TACTIC_ID.POINTING_ELIMINATION, TACTIC_ID.NAKED_PAIR, TACTIC_ID.HIDDEN_PAIR])
const extreme = new Map<TacticId, string>([
  [TACTIC_ID.SWORDFISH, 'Fish'], [TACTIC_ID.JELLYFISH, 'Fish'], [TACTIC_ID.FINNED_X_WING, 'Fish'],
  [TACTIC_ID.FINNED_SWORDFISH, 'Fish'], [TACTIC_ID.FINNED_JELLYFISH, 'Fish'],
  [TACTIC_ID.WXYZ_WING, 'Wings'], [TACTIC_ID.X_CHAIN, 'Chains'], [TACTIC_ID.XY_CHAIN, 'Chains'],
  [TACTIC_ID.AIC, 'Chains'], [TACTIC_ID.MEDUSA_3D, 'Colouring'],
])
const tactics = TACTICS.filter(item => item.id !== TACTIC_ID.NISHIO && item.id !== TACTIC_ID.UNIQUE_RECTANGLE &&
  item.id !== TACTIC_ID.BUG_PLUS_ONE)
const tiers = [
  tactics.filter(item => easy.has(item.id)), tactics.filter(item => medium.has(item.id)),
  tactics.filter(item => !easy.has(item.id) && !medium.has(item.id) && !extreme.has(item.id)),
  tactics.filter(item => extreme.has(item.id)),
]
const ordered = tiers.flat()
const labels: Partial<Record<TacticId, string>> = {
  [TACTIC_ID.NAKED_SINGLE]: 'Naked single', [TACTIC_ID.HIDDEN_SINGLE]: 'Hidden single',
  [TACTIC_ID.OPEN_SINGLES]: 'Last empty cell', [TACTIC_ID.POINTING_ELIMINATION]: 'Locked candidates',
}
export type LogicalStep = SolvingStep & { label: string; id: TacticId; diagonal?: boolean }

function nextStep(state: GridState, diagonal: boolean): LogicalStep | undefined {
  if (diagonal) for (const unit of diagonals) for (let digit = 1; digit <= 9; digit++) {
    const matches = unit.filter(cell => state.candidates[cell] & bit(digit))
    if (matches.length === 1) return { id: TACTIC_ID.HIDDEN_SINGLE, label: 'Hidden single', strategy: 'Hidden single',
      diagonal: true, type: 'value', updates: [{ index: matches[0], filledValue: digit }] }
  }
  for (const tactic of ordered) {
    const step = tactic.find(state)
    if (step?.updates.some(update => update.filledValue ? !state.values[update.index]
      : update.eliminatedCandidate && (state.candidates[update.index] & bit(update.eliminatedCandidate)))) {
      return { ...step, label: labels[tactic.id] ?? tactic.title.replace(/ Strategy$/, ''), id: tactic.id }
    }
  }
}

export function logicalHint(entries: readonly number[], excluded: readonly number[] = [], diagonal = false) {
  if (conflicts(entries, diagonal).size) return
  return nextStep({ values: [...entries], candidates: candidateMasks(entries, diagonal).map((mask, cell) => mask & ~(excluded[cell] ?? 0)) }, diagonal)
}

export function gradePuzzle(entries: readonly number[], diagonal = false) {
  const state: GridState = { values: [...entries], candidates: candidateMasks(entries, diagonal) }
  const groups = peerGroups(diagonal)
  const steps: LogicalStep[] = []
  const families = new Set<string>()
  let hardest = 0
  for (let count = 0; count < 810 && state.values.includes(0); count++) {
    const step = nextStep(state, diagonal)
    if (!step) break
    steps.push(step)
    const family = extreme.get(step.id)
    if (family) families.add(family)
    hardest = Math.max(hardest, family ? 3 : easy.has(step.id) ? 0 : medium.has(step.id) ? 1 : 2)
    for (const update of step.updates) {
      const { index, filledValue, eliminatedCandidate } = update
      if (filledValue) {
        state.values[index] = filledValue
        state.candidates[index] = 0
        for (const peer of groups[index]) state.candidates[peer] &= ~bit(filledValue)
      } else if (eliminatedCandidate) state.candidates[index] &= ~bit(eliminatedCandidate)
    }
  }
  const solved = rulesFor(diagonal).verify(entries, state.values)
  const grades: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Extreme']
  return { steps, extremeFamilies: [...families], difficulty: solved ? (families.size >= 3 ? 'Genius' : grades[hardest]) : undefined }
}
