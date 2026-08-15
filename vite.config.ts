import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const tauriDevHost = process.env.TAURI_DEV_HOST;
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: tauriDevHost || false,
    port: 1420,
    strictPort: true,
    ...(tauriDevHost
      ? {
          hmr: {
            protocol: 'ws' as const,
            host: tauriDevHost,
            port: 1421,
          },
        }
      : {}),
    watch: {
      ignored: ['**/src-tauri/**'],
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
