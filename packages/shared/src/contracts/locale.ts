export const SUPPORTED_UI_LOCALES = ['en-US', 'es-ES', 'fr-FR'] as const
export type UiLocale = typeof SUPPORTED_UI_LOCALES[number]
export const DEFAULT_UI_LOCALE: UiLocale = 'en-US'
