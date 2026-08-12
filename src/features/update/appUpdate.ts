import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const CHECK_APP_UPDATES_EVENT = 'stella://check-updates';

export interface AppUpdateInfo {
  currentVersion: string;
  version: string;
  notes?: string;
  date?: string;
}

export type AppUpdateInstallEvent =
  | { event: 'started' }
  | { event: 'progress'; chunkLength: number; contentLength?: number }
  | { event: 'finished' };

export async function checkForAppUpdate(): Promise<AppUpdateInfo | undefined> {
  if (!isTauri() || import.meta.env.VITE_E2E) return undefined;
  return (await invoke<AppUpdateInfo | null>('app_update_check')) ?? undefined;
}

export async function installAppUpdate(
  onEvent: (event: AppUpdateInstallEvent) => void,
): Promise<void> {
  await invoke('app_update_install', { onEvent: new Channel(onEvent) });
}

export async function listenForCheckAppUpdates(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  return listen(CHECK_APP_UPDATES_EVENT, handler);
}
