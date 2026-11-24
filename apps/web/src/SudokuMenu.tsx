import type { PublishedLevel } from '../../../packages/sudoku/src/contracts.js'
import { levelTitle, packDescription, packTitle } from './sudoku-copy.js'
import { knownMessage, useT, type Translate } from './i18n.js'
import { useState } from 'react'
import { Share2, Shuffle } from 'lucide-react'
import { difficulties, type Difficulty } from '../../../packages/game-sdk/src/index.js'
import { effectivePackRules, packLevels, type PackRules, type PublishedPack } from '../../../packages/sudoku/src/packs.js'
import { quickPlayVersion } from '../../../packages/sudoku/src/contracts.js'
import { formatSeedCode, parseSeedCode } from '../../../packages/sudoku/src/seed-code.js'
import { errorMessage } from './api.js'
import type { PackPresentation } from './GamePacks.js'

const sudokuPath = '/games/sudoku'

export function PuzzleShare({ level }: { level: PublishedLevel }) {
  const t = useT()
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!level.seed || level.pack || level.generatorVersion !== quickPlayVersion) return null
  const seed = formatSeedCode(level.seed, level.difficulty, level.generatorVersion)
  async function share() {
    setCopied(false)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: seed })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    setShow(true)
  }
  return show ? <div className="puzzle-share">
    <input readOnly aria-label={t("Seed code")} value={seed} onFocus={event => event.target.select()}/>
    {navigator.clipboard && <button className="secondary" onClick={() => {
      void navigator.clipboard.writeText(seed).then(() => setCopied(true)).catch(() => undefined)
    }}>{copied ? t("Copied") : t("Copy seed")}</button>}
    <button className="secondary" onClick={() => { setShow(false); setCopied(false) }}>{t("Close")}</button>
  </div>
    : <button className="text-button" onClick={() => { void share() }}><Share2 size={16}/>{" "}{t("Share seed")}</button>
}

export function QuickPlay({ canPlay, profile, generate }: {
  canPlay: boolean; profile: string
  generate: (difficulty: Difficulty, seed?: string, version?: number) => Promise<void>
}) {
  const t = useT()
  const params = new URLSearchParams(location.search)
  const received = params.get('sharedSeed')?.trim() ?? ''
  const sharedCode = parseSeedCode(received)
  const difficultyKey = 'aviarium:sudoku-difficulty:' + profile
  const [difficulty, setDifficulty] = useState(() => {
    const saved = localStorage.getItem(difficultyKey)
    return difficulties.find(value => value === saved) ?? 'Easy'
  })
  const [hasSeed, setHasSeed] = useState(() => params.has('seed') || Boolean(sharedCode))
  const [seed, setSeed] = useState(() => sharedCode ? received : params.get('seed')?.slice(0, 100) ?? '')
  const legacyForm = params.has('version') && seed === params.get('seed')
  const embedded = hasSeed && !legacyForm ? parseSeedCode(seed) : undefined
  const legacyDifficulty = hasSeed && seed === params.get('seed')
    ? difficulties.find(value => value === params.get('difficulty')) : undefined
  const seedDifficulty = embedded?.difficulty ?? legacyDifficulty
  const selectedDifficulty = seedDifficulty ?? difficulty
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  return <section className="quick-play panel" aria-labelledby="quick-title">
    <form onSubmit={event => {
      event.preventDefault()
      setProblem(''); setBusy(true)
      const legacyVersion = hasSeed && legacyForm ? Number(params.get('version')) : undefined
      void generate(selectedDifficulty, hasSeed ? (embedded?.seed ?? seed.trim()) : undefined,
        embedded?.version ?? legacyVersion)
        .catch(error => setProblem(errorMessage(error))).finally(() => setBusy(false))
    }}>
      <div className="quick-play-header">
        <h2 id="quick-title">{t("Quick Play")}</h2>
        <button type="button" className="text-button" aria-expanded={hasSeed} disabled={busy}
          onClick={() => setHasSeed(!hasSeed)}>{hasSeed ? t("Random seed") : t("Enter seed")}</button>
      </div>
      {hasSeed && <label className="quick-seed">{t("Puzzle seed")}<input maxLength={120} value={seed} required
        onChange={event => setSeed(event.target.value)}/></label>}
      <div className="quick-play-actions">
        <select aria-label={t("Difficulty")} value={selectedDifficulty} disabled={busy || Boolean(seedDifficulty)}
          onChange={event => {
            const next = event.target.value as Difficulty
            setDifficulty(next)
            localStorage.setItem(difficultyKey, next)
          }}>
          {difficulties.map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select>
        <button type="submit" className="primary" disabled={!canPlay || busy || (hasSeed && (!seed.trim() || (!embedded && seed.trim().length > 100)))}>
          <Shuffle size={17}/>{busy ? t("Preparing puzzle…") : hasSeed ? t("Play seed") : t("New puzzle")}
        </button>
      </div>
      {problem && <p className="error" role="alert">{knownMessage(t, problem)}</p>}
    </form>
  </section>
}

function gradeRange(t: Translate, pack: PublishedPack) {
  const tiers = pack.data.puzzles.map(puzzle => difficulties.indexOf(puzzle.difficulty))
  const min = Math.min(...tiers), max = Math.max(...tiers)
  return min === max ? t(difficulties[min]) : t(difficulties[min]) + '–' + t(difficulties[max])
}

export function displayTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function ruleLabels(t: Translate, rules: PackRules) {
  return [t(rules.inOrder ? 'In order' : 'Pick & choose'), !rules.hints && t('No hints'),
    !rules.autoNotes && t('No Auto notes'), rules.lives && t('{count, plural, one {# life} other {# lives}}', { count: rules.lives }),
    rules.timeTrial && t('Always show timer'), rules.diagonal && t('Diagonal Sudoku')].filter((label): label is string => typeof label === 'string')
}

export const sudokuPackPresentation: PackPresentation = {
  menuLabel: 'Sudoku menu',
  levels: pack => packLevels(pack as PublishedPack),
  title: (t, pack) => packTitle(t, pack as PublishedPack),
  description: (t, pack) => packDescription(t, pack as PublishedPack),
  levelTitle: (t, level) => levelTitle(t, level as PublishedLevel),
  detail: (t, level) => t((level as PublishedLevel).difficulty),
  details: (t, pack) => gradeRange(t, pack as PublishedPack),
  ruleLabels: (t, pack) => ruleLabels(t, pack.data.rules as PackRules),
  challenge(t, pack, stop) {
    const defaults = pack.data.rules as PackRules
    const rules = effectivePackRules(pack as PublishedPack, stop)
    return [
      rules.inOrder !== defaults.inOrder && t(rules.inOrder ? 'In order' : 'Pick & choose'),
      rules.hints !== defaults.hints && t(rules.hints ? 'Hints available' : 'No hints'),
      rules.autoNotes !== defaults.autoNotes && t(rules.autoNotes ? 'Auto notes available' : 'No Auto notes'),
      rules.timeTrial !== defaults.timeTrial && t(rules.timeTrial ? 'Always show timer' : 'Use timer preference'),
      Boolean(rules.diagonal) !== Boolean(defaults.diagonal) && t(rules.diagonal ? 'Diagonal Sudoku' : 'Classic Sudoku'),
      rules.lives !== defaults.lives && (rules.lives
        ? t('{count, plural, one {# life} other {# lives}}', { count: rules.lives }) : t('Unlimited lives')),
    ].filter(Boolean).join(' · ')
  },
  bestTime(t, pack, stop, completions) {
    if (effectivePackRules(pack as PublishedPack, stop).timeTrial && completions.length)
      return t('Best {time}', { time: displayTime(Math.min(...completions.map(save => save.elapsedMs))) })
  },
}
