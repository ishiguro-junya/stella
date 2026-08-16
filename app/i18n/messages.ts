import en from './locales/en.json';
import ja from './locales/ja.json';

const checkedEnglish: Record<keyof typeof ja, string> = en;
const checkedJapanese: Record<keyof typeof en, string> = ja;

export const defaultNS = 'translation';
export const resources = {
  en: { translation: checkedEnglish },
  ja: { translation: checkedJapanese },
} as const;

export type MessageArgs = Readonly<Record<string, string | number>>;
export type MessageKey = keyof typeof en;

export function isMessageKey(value: unknown): value is MessageKey {
  return (
    typeof value === 'string' &&
    Object.hasOwn(checkedEnglish, value) &&
    Object.hasOwn(checkedJapanese, value)
  );
}
