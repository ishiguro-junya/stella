import i18next, { createInstance, use as registerI18nextPlugin, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next';
import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

import { defaultNS, isMessageKey, resources, type MessageArgs, type MessageKey } from './messages';

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

function initializeI18n(instance: i18n, language: Language): i18n {
  void instance.init({
    defaultNS,
    fallbackLng: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    keySeparator: false,
    lng: language,
    react: { bindI18nStore: 'added removed', useSuspense: false },
    resources: structuredClone(resources),
    returnNull: false,
    supportedLngs: ['ja', 'en'],
  });
  return instance;
}

registerI18nextPlugin(initReactI18next);
const translationInstance = initializeI18n(i18next, 'en');

function createI18n(language: Language): i18n {
  return initializeI18n(createInstance(), language);
}

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

function localeForLanguage(language: Language): 'ja-JP' | 'en-US' {
  return language === 'ja' ? 'ja-JP' : 'en-US';
}

export function isLanguage(value: unknown): value is Language {
  return value === 'ja' || value === 'en';
}

export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language;
}

export function translate(language: Language, id: MessageKey, args: MessageArgs = {}): string {
  return translationInstance.t(id, { ...args, lng: language });
}

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const instanceRef = useRef<i18n>(undefined);
  if (!instanceRef.current) instanceRef.current = createI18n(language);
  const instance = instanceRef.current;

  useLayoutEffect(() => {
    for (const candidate of ['en', 'ja'] as const) {
      instance.addResourceBundle(candidate, defaultNS, resources[candidate][defaultNS], true, true);
    }
    void instance.changeLanguage(language);
    applyDocumentLanguage(language);
  }, [instance, language]);

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

export function useI18n(): I18nValue {
  const { t: i18nextT, i18n: instance } = useTranslation();
  const language = isLanguage(instance.resolvedLanguage)
    ? instance.resolvedLanguage
    : isLanguage(instance.language)
      ? instance.language
      : 'en';
  const locale = localeForLanguage(language);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const t = useCallback<I18nValue['t']>((id, args = {}) => i18nextT(id, args), [i18nextT]);
  const message = useCallback<I18nValue['message']>(
    (value) => i18nextT(value.id, value.args ?? {}),
    [i18nextT],
  );
  const formatNumber = useCallback(
    (candidate: number) => numberFormatter.format(candidate),
    [numberFormatter],
  );
  const formatDate = useCallback<I18nValue['formatDate']>(
    (candidate, options) =>
      new Intl.DateTimeFormat(locale, options).format(
        candidate instanceof Date ? candidate : new Date(candidate),
      ),
    [locale],
  );

  return useMemo(
    () => ({ language, locale, t, message, formatNumber, formatDate }),
    [formatDate, formatNumber, language, locale, message, t],
  );
}
