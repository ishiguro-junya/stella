import { invoke } from '@tauri-apps/api/core';

export type ToolchainMode = 'bundled' | 'system';

interface ToolchainComponentStatus {
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
  ignorePatterns: string;
}

export interface ToolchainAdapter {
  status: () => Promise<ToolchainStatus>;
  setMode: (mode: ToolchainMode) => Promise<ToolchainStatus>;
  setIgnorePatterns: (patterns: string) => Promise<ToolchainStatus>;
}

export function createTauriToolchainAdapter(): ToolchainAdapter {
  return {
    status: () => invoke<ToolchainStatus>('toolchain_status'),
    setMode: (mode) =>
      invoke<ToolchainStatus>('toolchain_set_mode', {
        request: { mode },
      }),
    setIgnorePatterns: (patterns) =>
      invoke<ToolchainStatus>('toolchain_set_ignore_patterns', {
        request: { patterns },
      }),
  };
}
