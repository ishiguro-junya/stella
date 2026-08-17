import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const tauriDevHost = process.env.TAURI_DEV_HOST;
const devPort = Number(process.env.STELLA_DEV_PORT ?? 1420);
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);
const managedWorktreesDirectory = resolve('worktrees');

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: tauriDevHost || false,
    port: devPort,
    strictPort: true,
    ...(tauriDevHost
      ? {
          hmr: {
            protocol: 'ws' as const,
            host: tauriDevHost,
            port: devPort,
          },
        }
      : {}),
    watch: {
      ignored: [
        '**/app/native/**',
        (path) =>
          path === managedWorktreesDirectory || path.startsWith(`${managedWorktreesDirectory}/`),
      ],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // LefthookはViteとCargoを並列で実行する。
    // ハッシュ付きの既存ファイルを残し、`generate_context!`の処理中にファイルが消えないようにする。
    // Tauriのビルドは`beforeBuildCommand`の後に直列で実行されるため、配布用ビルドでは出力先を空にできる。
    emptyOutDir: isTauriBuild,
    sourcemap: false,
  },
});
