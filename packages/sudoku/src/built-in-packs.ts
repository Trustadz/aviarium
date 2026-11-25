import type { PackDraftData } from './packs.js'

const title = 'Budgies'
const description = 'Follow the flock from the garden perch to the treetops in three Sudoku puzzles.'
const rules = { hints: true, autoNotes: true, inOrder: true, lives: null, timeTrial: false }

export const builtInPacks: { id: string; revision: number; coverFile?: string; data: PackDraftData }[] = [{
  id: 'budgies', revision: 1, coverFile: 'budgies-portrait.webp',
  data: {
    format: 2, game: 'sudoku', title, description,
    chapters: [{
      id: 'chapter-1', title, description, theme: 'meadow', rules,
      puzzles: [
        { levelId: 'pack:budgies:1', title: 'Garden Perch', ruleset: 1, grid: '054003009962010730137005060006109000500074210001002983010847300000906040049531070' },
        { levelId: 'pack:budgies:2', title: 'Eucalyptus Grove', ruleset: 1, grid: '400000090008050006000046801030100000904000070870094000340000120500007600000002000' },
        { levelId: 'pack:budgies:3', title: 'Flight at Dusk', ruleset: 1, grid: '000000009004000013003007000005800300070903045090000000800620000000081600032400900' },
      ],
    }],
  },
}]
