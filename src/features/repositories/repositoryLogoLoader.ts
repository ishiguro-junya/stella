import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export type RepositoryLogoLoader = (path: string) => Promise<string | undefined>;

export const loadRepositoryLogo: RepositoryLogoLoader = async (path) => {
  const logoPath = await invoke<string | null>('repository_logo', { path });
  return logoPath ? convertFileSrc(logoPath) : undefined;
};
