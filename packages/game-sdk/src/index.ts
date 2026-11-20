export interface GameMetadata {
  id: string
  title: string
  description: string
  tags: readonly string[]
  eReader: boolean
  input: readonly ('keyboard' | 'pointer' | 'touch')[]
}

export interface GameRules<Level, State, Move, Solution> {
  ruleset: number
  saveFormat: number
  create(level: Level): State
  apply(level: Level, state: State, move: Move): State
  verify(level: Level, candidate: Solution): boolean
}

export type Validation<Solution> =
  | { kind: 'invalid'; reason: string }
  | { kind: 'unsolvable' }
  | { kind: 'inconclusive'; solution?: Solution }
  | { kind: 'unique'; solution: Solution }
  | { kind: 'multiple'; solution: Solution }

export type Difficulty = 'Easy' | 'Medium' | 'Hard'
export interface PublishedLevel {
  id: string
  revision: number
  ruleset: number
  title: string
  grid: string
  difficulty: Difficulty
  source: 'Built-in' | 'Generated' | 'Creator'
}

export interface SaveEnvelope {
  game: string
  level: string
  levelRevision: number
  ruleset: number
  format: number
}
