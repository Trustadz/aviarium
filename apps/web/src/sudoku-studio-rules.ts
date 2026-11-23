import type { RuleGroup } from './StudioRuleFields.js'

export const sudokuRuleGroups: readonly RuleGroup[] = [
  { label: 'Player aids', fields: [
    { key: 'hints', label: 'Allow hints', kind: 'switch' },
    { key: 'autoNotes', label: 'Allow Auto notes', kind: 'switch' },
  ] },
  { label: 'Challenge rules', fields: [
    { key: 'timeTrial', label: 'Always show timer', kind: 'switch' },
    { key: 'diagonal', label: 'Diagonal Sudoku', kind: 'switch',
      description: 'Both diagonals must also contain the digits 1 to 9.' },
    { key: 'lives', label: 'Lives', kind: 'lives',
      description: 'A wrong number costs a life. The attempt ends when all lives are gone.' },
  ] },
]
