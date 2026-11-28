import { ArrowLeft, ChevronDown, Share2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { formatSeedCode, type SeedBoard, type SeedError, type SeedOptions,
  type SeedPayload } from '../../../packages/game-sdk/src/seed-code.js'
import type { GameLevel } from '../../../packages/game-sdk/src/index.js'
import type { PlayOptions } from '../../../packages/game-sdk/src/progress.js'
import { useT } from './i18n.js'
import type { Message } from './messages.js'
import { parseSeed, sameSeedBoard, seedBoardFields, seedBoardLabel } from './seed.js'
import type { WebGame } from './game-web.js'
import './quick-play.css'
import './seed-screen.css'

function errorMessage(t: ReturnType<typeof useT>, error: SeedError) {
  switch (error) {
    case 'unsupported-version': return t('This seed code uses an unsupported version.')
    case 'wrong-game': return t('This seed code is for a different game.')
    case 'invalid-options': return t('This seed code has options this game cannot use.')
    default: return t('This seed code is invalid.')
  }
}

export function SeedScreen({ game, initialCode, launch, back }: {
  game: WebGame
  initialCode?: string
  launch: (level: GameLevel, options?: { playOptions?: PlayOptions }) => Promise<void>
  back: () => void
}) {
  const t = useT()
  const parsedInitial = initialCode ? parseSeed(game, initialCode) : undefined
  const [raw, setRaw] = useState(initialCode ?? '')
  const [payload, setPayload] = useState<SeedPayload | undefined>(parsedInitial?.ok ? parsedInitial.value : undefined)
  const [board, setBoard] = useState<SeedBoard>(parsedInitial?.ok ? parsedInitial.value.board : {})
  const [options, setOptions] = useState<SeedOptions>(parsedInitial?.ok ? parsedInitial.value.options : {})
  const [error, setError] = useState<SeedError | undefined>(parsedInitial && !parsedInitial.ok ? parsedInitial.error : undefined)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const optionsId = useId()
  const fields = seedBoardFields(game)
  const boardChanged = Boolean(payload && !sameSeedBoard(board, payload.board))
  const optionsChanged = Boolean(payload && (game.playOptions ?? []).some(option => options[option.key] !== payload.options[option.key]))
  const currentCode = payload ? formatSeedCode({ ...payload, board, options }) : ''

  function load(code = raw) {
    setProblem(''); setCopied(false)
    const result = parseSeed(game, code)
    if (!result.ok) { setError(result.error); setPayload(undefined); return }
    setError(undefined)
    setPayload(result.value)
    setBoard(result.value.board)
    setOptions(result.value.options)
    setRaw(code)
  }

  async function copy() {
    if (!currentCode) return
    try {
      await navigator.clipboard.writeText(currentCode)
      setCopied(true)
    } catch {
      window.prompt(t('Copy code'), currentCode)
    }
  }

  function start() {
    if (!payload || !game.seed || busy) return
    setBusy(true); setProblem('')
    void game.seed.generate(payload.seed, board)
      .then(level => launch(level, { playOptions: options }))
      .catch((reason: unknown) => setProblem(reason instanceof Error ? reason.message : t('Could not prepare this seed.')))
      .finally(() => setBusy(false))
  }

  return <section className="catalog seed-screen" aria-labelledby="seed-title">
    <div className="game-navigation seed-screen-back">
      <button className="text-button back" onClick={back}><ArrowLeft size={17}/> {game.title}</button>
    </div>
    <h1 id="seed-title">{t('Play a seed')}</h1>
    <p className="seed-screen-intro">{payload ? t('Review the puzzle and adjust its options.') : t('Use a code shared by another player.')}</p>
    <form className="seed-card" onSubmit={event => { event.preventDefault(); load() }}>
      <label className="seed-code-field">
        <span>{t('Seed code')}</span>
        <input ref={input} value={raw} maxLength={4000} placeholder={t('Paste or enter a code')}
          onChange={event => setRaw(event.target.value)} aria-invalid={error ? true : undefined}/>
      </label>
      <button className="primary" type="submit">{t('Load seed')}</button>
    </form>
    {error && <p className="error" role="alert">{errorMessage(t, error)}</p>}
    {payload && <>
      <div className="seed-loaded-line"><strong>{seedBoardLabel(game, t, board)}</strong>
        {boardChanged && <span>{t('Board settings changed')}</span>}
      </div>
      {fields.length > 0 && <details className="seed-card seed-board-settings">
        <summary><span>{t('Board settings')}</span><ChevronDown size={18} aria-hidden="true"/></summary>
        <div className="seed-board-fields">
          {fields.map(field => <label className="quick-play-option-select" key={field.key}>
            <span>{t(field.label as Message)}</span>
            <select value={String(board[field.key] ?? field.choices[0]?.value)}
              onChange={event => {
                const choice = field.choices.find(item => String(item.value) === event.target.value)
                if (choice) setBoard(current => ({ ...current, [field.key]: choice.value }))
              }}>
              {field.choices.map(choice => <option key={choice.value} value={String(choice.value)}>
                {t(choice.label as Message)}
              </option>)}
            </select>
          </label>)}
        </div>
      </details>}
      {boardChanged && <p className="seed-warning" role="status">
        {t('Changing board settings changes the puzzle. The seed stays the same.')}
      </p>}
      {(game.playOptions?.length ?? 0) > 0 && <section className="seed-card seed-options" aria-labelledby={optionsId}>
        <h2 id={optionsId}>{t('Play options')}</h2>
        <p>{optionsChanged ? t('Play options changed for this play.') : t('Loaded from the shared code.')}</p>
        {(game.playOptions ?? []).map(option => <label className="quick-play-option-switch" key={option.key}>
          <span>{t(option.label)}</span>
          <input type="checkbox" role="switch" checked={Boolean(options[option.key])}
            onChange={event => setOptions(current => ({ ...current, [option.key]: event.target.checked }))}/>
        </label>)}
      </section>}
      <button className="primary seed-start" disabled={busy} onClick={start}>
        {busy ? t('Preparing puzzle…') : t('Start puzzle')}
      </button>
      <p className="muted seed-note">{t('Uses the same puzzle with your selected options.')}</p>
      <button className="secondary seed-copy" onClick={copy}>{copied ? t('Copied') : t('Copy code')}</button>
      {problem && <p className="error" role="alert">{problem}</p>}
    </>}
  </section>
}

/** Copy the versioned seed code representing the level and played options. */
export function SeedShare({ code }: { code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  async function share() {
    setCopied(false)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: code })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      window.prompt(t('Copy code'), code)
    }
  }
  return <button className="text-button" onClick={() => { void share() }}>
    <Share2 size={16} aria-hidden="true"/> {copied ? t('Copied') : t('Share seed')}
  </button>
}
