/**
 * Minimal i18n: t('English text') looks the string up in the active locale's
 * dictionary and falls back to the English original when missing — so
 * untranslated strings are never broken, just English. English needs no
 * dictionary (keys ARE the English copy).
 *
 * Locale persists in localStorage; switching reloads the app (pragmatic:
 * avoids reactive re-render plumbing through 40 legacy components).
 * @module
 */

import es from '../data/i18n-es.json'

const DICTS = { es }

let locale = 'en'
try {
    locale = window.localStorage.getItem('LaserWeb.locale') || 'en'
} catch (e) { /* ignore */ }

export function t(text) {
    const dict = DICTS[locale]
    return (dict && dict[text]) || text
}

export function getLocale() {
    return locale
}

export const LOCALES = ['en', ...Object.keys(DICTS)]

export function setLocale(next) {
    try {
        window.localStorage.setItem('LaserWeb.locale', next)
    } catch (e) { /* ignore */ }
    window.location.reload()
}
