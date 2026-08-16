import { invoke, isTauri } from '@tauri-apps/api/core';

import type { Language } from './i18n';

export async function applyNativeLanguage(language: Language): Promise<void> {
  if (!isTauri()) return;
  await invoke('set_app_language', { language });
}
