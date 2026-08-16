import { invoke, isTauri } from '@tauri-apps/api/core';

export async function openFilesAndFoldersSystemSettings(): Promise<void> {
  if (!isTauri()) return;
  await invoke('open_files_and_folders_settings');
}
