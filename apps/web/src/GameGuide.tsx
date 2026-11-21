import type { Message } from './messages.js'
import { useT } from './i18n.js'
import { useEffect, useRef, type MouseEvent } from 'react'
import { ArrowLeft } from 'lucide-react'

export type GuideSection = { title: Message; paragraphs: readonly Message[] }

export function GameGuide({ game, menuUrl, sections, leave }: {
  game: string; menuUrl: string; sections: readonly GuideSection[]
  leave: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const t = useT()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  return <article className="catalog game-guide" aria-labelledby="game-guide-title">
    <a className="text-button back" href={menuUrl} onClick={leave}><ArrowLeft size={17}/> {t('{game} menu', { game })}</a>
    <h1 id="game-guide-title" ref={heading} tabIndex={-1}>{t('How to play {game}', { game })}</h1>
    {sections.map(section => <section className="panel game-guide-section" key={section.title}>
      <h2>{t(section.title)}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}
    </section>)}
  </article>
}
