import { open } from '@tauri-apps/plugin-dialog';

export type DirectoryPicker = (title: string) => Promise<string | null>;

export const pickDirectory: DirectoryPicker = async (title) => {
  if (
    import.meta.env.VITE_E2E === 'true' &&
    Object.hasOwn(window, 'stellaE2eDirectoryPickerResult')
  ) {
    // Native WebDriverからFinderを操作できないため、E2Eビルドだけで一回分の選択結果を受け取ります。
    const selected = window.stellaE2eDirectoryPickerResult;
    delete window.stellaE2eDirectoryPickerResult;
    return selected ?? null;
  }
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === 'string' ? selected : null;
};
