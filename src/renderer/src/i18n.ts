import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@locales/en.json'
import fr from '@locales/fr.json'

/** Add a language: create locales/<code>.json, import it here, and add it to LANGUAGES. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const

const resources = { en: { translation: en }, fr: { translation: fr } }
const supported = LANGUAGES.map((l) => l.code as string)

export function systemLanguage(): string {
  const code = navigator.language.split('-')[0]
  return supported.includes(code) ? code : 'en'
}

i18n.use(initReactI18next).init({
  resources,
  lng: systemLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
