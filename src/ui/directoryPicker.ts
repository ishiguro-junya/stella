import { open } from '@tauri-apps/plugin-dialog';

export type DirectoryPicker = (title: string) => Promise<string | null>;

export const pickDirectory: DirectoryPicker = async (title) => {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === 'string' ? selected : null;
};
