// Translations. The English text itself is the key, so the interface works in
// English with no translation file. To add a language later, create
// site/i18n/hy.json (Armenian) or site/i18n/ru.json (Russian) mapping each
// English phrase to its translation, e.g. { "Born": "Ծնվել է" }.
import { safeStorage } from './dom.js';

let strings = {};
let current = 'en';

export const LANGUAGES = { en: 'English' }; // add { hy: 'Հայերեն', ru: 'Русский' } when translated

export async function loadLanguage(base, lang = safeStorage.get('localStorage', 'fa:lang') || 'en') {
  current = lang;
  document.documentElement.lang = lang;
  if (lang === 'en') { strings = {}; return; }
  try {
    const res = await fetch(`${base}i18n/${lang}.json`, { cache: 'no-cache' });
    strings = res.ok ? await res.json() : {};
  } catch {
    strings = {};
  }
}

export const currentLanguage = () => current;

/** t('Born in {place}', { place: 'Kars' }) */
export function t(text, vars) {
  let out = strings[text] || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return out;
}
