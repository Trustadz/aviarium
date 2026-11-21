import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createIntl, createIntlCache, IntlProvider, useIntl } from 'react-intl'
import { isLocale, languageNames, locales, type Locale } from '../../../packages/game-sdk/src/locales.js'
import { dutch, type Message } from './messages.js'

const localeKey = 'aviarium:locale'
const enabledKey = 'aviarium:enabled-locales'
const english = Object.fromEntries(Object.keys(dutch).map(message => [message, message]))
const messages = { en: english, nl: dutch }
const cache = createIntlCache()
const languageContext = createContext<{ enabled: readonly Locale[]; setLocale: (locale: Locale) => void }>({
  enabled: locales, setLocale: () => undefined,
})

function enabledLocales(value: unknown): Locale[] | undefined {
  if (Array.isArray(value) && value.length && value.every(isLocale)) return [...new Set(value)]
}

function cachedLocales() {
  try { return enabledLocales(JSON.parse(localStorage.getItem(enabledKey) ?? 'null')) ?? locales }
  catch { return locales }
}

export function I18n({ children, profileLocale, onProfileLocale }: {
  children: ReactNode; profileLocale?: Locale; onProfileLocale?: (locale: Locale) => void
}) {
  const [enabled, setEnabled] = useState<readonly Locale[]>(cachedLocales)
  const [choice, setChoice] = useState(() => localStorage.getItem(localeKey))
  const preferred = navigator.languages.map(language => language.toLowerCase().split('-')[0])
    .filter(isLocale).find(language => enabled.includes(language))
  const saved = profileLocale ?? choice
  const locale = isLocale(saved) && enabled.includes(saved) ? saved : preferred ?? enabled[0]

  useEffect(() => {
    async function refresh() {
      const response = await fetch('/api/locales', { cache: 'no-store' })
      if (!response.ok) return
      const values = enabledLocales((await response.json()).enabled)
      if (!values) return
      localStorage.setItem(enabledKey, JSON.stringify(values))
      setEnabled(values)
    }
    const sync = () => { void refresh().catch(() => undefined) }
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])

  return <languageContext.Provider value={{ enabled, setLocale(value) {
    if (onProfileLocale) onProfileLocale(value)
    else {
      localStorage.setItem(localeKey, value)
      setChoice(value)
    }
  } }}>
    <IntlProvider locale={locale} defaultLocale="en" messages={messages[locale]}>
      <DocumentLanguage/>
      {children}
    </IntlProvider>
  </languageContext.Provider>
}

export type Translate = (message: Message, values?: Record<string, string | number>) => string

export function useT(): Translate {
  const intl = useIntl()
  return useCallback((message, values) => intl.formatMessage({ id: message, defaultMessage: message }, values), [intl])
}

export function formatMessage(message: Message, values: Record<string, string> = {}) {
  const language = document.documentElement.lang === 'nl' ? 'nl' : 'en'
  return createIntl({ locale: language, messages: messages[language] }, cache).formatMessage({ id: message }, values)
}

export function knownMessage(t: Translate, message: string) {
  return Object.hasOwn(dutch, message) ? t(message as Message) : message
}

function DocumentLanguage() {
  const { locale } = useIntl()
  const t = useT()
  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.title = t('Aviarium · Puzzle library')
    document.querySelector('meta[name="description"]')?.setAttribute('content',
      t('Aviarium is a personal puzzle library for quiet, focused play.'))
  }, [locale, t])
  return null
}

export function useLanguageSelectionAvailable() {
  return useContext(languageContext).enabled.length > 1
}

export function LanguageSelector() {
  const { enabled, setLocale } = useContext(languageContext)
  const { locale } = useIntl()
  const t = useT()
  if (enabled.length < 2) return null
  return <label className="setting-row">{t('Language')}
    <select value={locale} onChange={event => {
      if (isLocale(event.target.value) && enabled.includes(event.target.value)) setLocale(event.target.value)
    }}>
      {enabled.map(value => <option key={value} value={value} lang={value}>{languageNames[value]}</option>)}
    </select>
  </label>
}
