import { invoke } from '@tauri-apps/api/core';

export type ToolchainMode = 'bundled' | 'system';

export interface ToolchainComponentStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface ToolchainStatus {
  activeMode: ToolchainMode;
  selectedMode: ToolchainMode;
  restartRequired: boolean;
  git: ToolchainComponentStatus;
  gitLfs: ToolchainComponentStatus;
  gitFlow: ToolchainComponentStatus;
  gpgAvailable: boolean;
}

export interface ToolchainAdapter {
  status: () => Promise<ToolchainStatus>;
  setMode: (mode: ToolchainMode) => Promise<ToolchainStatus>;
}

export function createTauriToolchainAdapter(): ToolchainAdapter {
  return {
    status: () => invoke<ToolchainStatus>('toolchain_status'),
    setMode: (mode) =>
      invoke<ToolchainStatus>('toolchain_set_mode', {
        request: { mode },
      }),
  };
}
