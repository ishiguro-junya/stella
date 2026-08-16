import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const OPEN_SETTINGS_EVENT = 'stella://open-settings';

export type OpenSettingsHandler = () => void;

export async function listenForOpenSettings(handler: OpenSettingsHandler): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  return listen(OPEN_SETTINGS_EVENT, () => handler());
}
