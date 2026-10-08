/**
 * Cartridge-local i18n (same pattern as mnemo-resto).
 *
 * Language resolution, first match wins:
 *   1. a language pinned by the person ('mnemo_crm_lang_mode')
 *   2. the host language: `?lang=` from the PluginWidget, then live
 *      MNEMO_CONFIG_UPDATE messages when the host switches
 *   3. the browser language
 *   4. 'en'
 */
import { useEffect, useState } from 'react';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';

export type LangCode = 'en' | 'fr' | 'es';
export type LangMode = 'auto' | LangCode;

const DICTIONARY: Record<LangCode, Record<string, string>> = {
  en: en as Record<string, string>,
  fr: fr as Record<string, string>,
  es: es as Record<string, string>,
};

const MODE_KEY = 'mnemo_crm_lang_mode';

function isLangCode(v: string | null | undefined): v is LangCode {
  return !!v && v in DICTIONARY;
}

function hostLangFromUrl(): LangCode | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlLang = (params.get('lang') || params.get('locale') || '').slice(0, 2);
    return isLangCode(urlLang) ? urlLang : null;
  } catch (err) {
    console.warn('[mnemo-crm] could not read the host language from the URL:', err);
    return null;
  }
}

function browserLang(): LangCode {
  const nav = (navigator.language || '').slice(0, 2);
  return isLangCode(nav) ? nav : 'en';
}

function loadMode(): LangMode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'auto' || isLangCode(saved)) return saved;
  } catch (err) {
    console.warn('[mnemo-crm] localStorage unreadable, language follows the host:', err);
  }
  return 'auto';
}

let currentMode: LangMode = loadMode();
let hostLang: LangCode | null = hostLangFromUrl();

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

export function getLanguage(): LangCode {
  if (currentMode !== 'auto') return currentMode;
  return hostLang ?? browserLang();
}

/** Called from main.tsx with every host config broadcast. */
export function setHostLanguage(lang: string | undefined) {
  const code = (lang ?? '').slice(0, 2);
  if (isLangCode(code) && code !== hostLang) {
    hostLang = code;
    notify();
  }
}

export function getLangMode(): LangMode {
  return currentMode;
}

export function setLangMode(mode: LangMode) {
  currentMode = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (err) {
    console.warn('[mnemo-crm] language choice not persisted:', err);
  }
  notify();
}

/** Translate a key with optional {{var}} interpolation. A missing key falls back to English, then to the key. */
export function translate(key: string, variables?: Record<string, string | number>): string {
  const lang = getLanguage();
  let text = DICTIONARY[lang][key] ?? DICTIONARY.en[key] ?? key;
  if (variables) {
    for (const [k, v] of Object.entries(variables)) {
      text = text.split(`{{${k}}}`).join(String(v));
    }
  }
  return text;
}

/** One / many without a plural library: `key.one` and `key.many`. */
export function translateCount(key: string, count: number, variables?: Record<string, string | number>): string {
  return translate(`${key}.${count === 1 ? 'one' : 'many'}`, { count, ...variables });
}

export function useI18n() {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return { t: translate, tc: translateCount, lang: getLanguage(), langMode: getLangMode(), setLangMode };
}
