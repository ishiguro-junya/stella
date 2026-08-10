import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { isMessageKey, MESSAGES, type MessageArgs, type MessageKey } from './messages';

export type Language = 'ja' | 'en';

export interface LocalizedMessage {
  id: MessageKey;
  args?: MessageArgs;
}

export function isLocalizedMessage(value: unknown): value is LocalizedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; args?: unknown };
  if (!isMessageKey(candidate.id)) return false;
  if (candidate.args === undefined) return true;
  if (
    typeof candidate.args !== 'object' ||
    candidate.args === null ||
    Array.isArray(candidate.args)
  )
    return false;
  return Object.values(candidate.args).every(
    (argument) => typeof argument === 'string' || typeof argument === 'number',
  );
}

export interface I18nValue {
  language: Language;
  locale: 'ja-JP' | 'en-US';
  t: (id: MessageKey, args?: MessageArgs) => string;
  message: (value: LocalizedMessage) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
}

function createI18nValue(language: Language): I18nValue {
  const locale = localeForLanguage(language);
  const numberFormatter = new Intl.NumberFormat(locale);
  return {
    language,
    locale,
    t: (id, args) => translate(language, id, args),
    message: (message) => translate(language, message.id, message.args),
    formatNumber: (candidate) => numberFormatter.format(candidate),
    formatDate: (candidate, options) =>
      new Intl.DateTimeFormat(locale, options).format(
        candidate instanceof Date ? candidate : new Date(candidate),
      ),
  };
}

const I18nContext = createContext<I18nValue>(createI18nValue('en'));

export function detectLanguage(languages?: readonly string[]): Language {
  const browserLanguages = globalThis.navigator?.languages;
  const candidates =
    languages ??
    (browserLanguages?.length
      ? browserLanguages
      : globalThis.navigator?.language
        ? [globalThis.navigator.language]
        : []);
  const first = candidates.find((candidate) => candidate.trim().length > 0);
  return first?.toLowerCase().split(/[-_]/u)[0] === 'ja' ? 'ja' : 'en';
}

export function localeForLanguage(language: Language): 'ja-JP' | 'en-US' {
  return language === 'ja' ? 'ja-JP' : 'en-US';
}

export function isLanguage(value: unknown): value is Language {
  return value === 'ja' || value === 'en';
}

export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language;
}

export function translate(language: Language, id: MessageKey, args: MessageArgs = {}): string {
  const value = MESSAGES[id][language];
  if (typeof value === 'function') {
    const numberFormatter = new Intl.NumberFormat(localeForLanguage(language));
    return value(args, { number: (candidate) => numberFormatter.format(candidate) });
  }
  return value.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, key: string) =>
    args[key] === undefined ? `{${key}}` : String(args[key]),
  );
}

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => createI18nValue(language), [language]);

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
