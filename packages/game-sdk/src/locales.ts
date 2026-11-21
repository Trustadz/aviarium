export const locales = ['en', 'nl'] as const
export type Locale = typeof locales[number]

export const languageNames = { en: 'English', nl: 'Nederlands' } satisfies Record<Locale, string>

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'nl'
}
