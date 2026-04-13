import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { ptBR } from "../locales/pt-BR.ts";
import { en } from "../locales/en.ts";

export const SUPPORTED_LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

const STORAGE_KEY = "dca.locale";

/**
 * Read the persisted locale override, or fall back to pt-BR. We deliberately
 * do NOT sniff `navigator.language` — pt-BR is the intended default for this
 * app; an English speaker opts in via the header switcher which writes to
 * localStorage.
 */
function initialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "pt-BR" || stored === "en") return stored;
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    en: { translation: en },
  },
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Keep <html lang> in sync with the active locale so screen readers and
// the browser's number/date formatting defaults follow it. Also persist
// the switcher choice so it sticks across reloads.
function syncLanguage(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, lng);
  }
}
syncLanguage(i18n.language);
i18n.on("languageChanged", syncLanguage);

export { i18n };
