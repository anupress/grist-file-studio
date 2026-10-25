// The interface's language: English, German or French.
//
// The code is written in English and English is the key: t('Columns') looks the string up in the
// German or French table and falls back to the English when there is no entry, so a missing translation is
// an English word, never a broken screen. Data from the person's tables is never translated.
//
// The choice is per browser, as in Invoice Studio: it is how one person reads the widget, and two
// people on one document may read different languages. Automatic follows Grist's own interface
// language (the `language` parameter Grist puts in the widget's URL), then the browser.

import { DE } from './de.js';
import { FR } from './fr.js';

const TABLES = { de: DE, fr: FR };
const KEY = 'galleryStudio.uiLanguage';
export const UI_LANGUAGES = [
  { id: 'auto', label: 'Automatic' },
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
];

let lang = 'en';

function gristLanguage() {
  try { return new URLSearchParams(location.search).get('language') || ''; } catch { return ''; }
}

/** 'auto' | 'en' | 'de' | 'fr' as stored in this browser. */
export function storedLanguage() {
  try { const v = localStorage.getItem(KEY); return UI_LANGUAGES.some((l) => l.id === v) ? v : 'auto'; } catch { return 'auto'; }
}

export function resolveLanguage(choice, grist = gristLanguage(), browser = (typeof navigator !== 'undefined' && navigator.language) || '') {
  if (choice === 'en' || choice === 'de' || choice === 'fr') return choice;
  const m = /^(de|fr)\b/i.exec(grist || browser);
  return m ? m[1].toLowerCase() : 'en';
}

export function setLanguage(choice, { remember = true } = {}) {
  if (remember) { try { localStorage.setItem(KEY, choice); } catch { /* private window */ } }
  lang = resolveLanguage(choice);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export const uiLang = () => lang;

/**
 * Translate, then fill {placeholders}. A key ending in " [one]" is the singular of a word English
 * writes the same in both numbers ("1 free", "3 free") but French does not ("1 libre", "3 libres"):
 * English drops the mark.
 */
export function t(s, vars) {
  let out = TABLES[lang]?.[s] || (s.endsWith(' [one]') ? s.slice(0, -6) : s);
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  return out;
}

/** Plural by count: tn(n, '{n} file', '{n} files'). */
export const tn = (n, one, many) => t(n === 1 ? one : many, { n });

/** The locale dates are written in: the interface's language (Grist's region of it when they match), else Grist's or the browser's English. */
export function dateLocale(culture) {
  if (lang === 'de') return /^de\b/i.test(culture || '') ? culture : 'de-DE';
  if (lang === 'fr') return /^fr\b/i.test(culture || '') ? culture : 'fr-FR';
  const c = culture || (typeof navigator !== 'undefined' && navigator.language) || 'en-GB';
  return /^en\b/i.test(c) ? c : 'en-GB';
}
