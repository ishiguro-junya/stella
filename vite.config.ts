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
    // Lefthook runs Vite and Cargo in parallel. Keeping existing hashed assets prevents
    // generate_context! from observing files disappear mid-compile. Tauri's own build
    // is serialized after beforeBuildCommand, so release builds can safely start clean.
    emptyOutDir: isTauriBuild,
    sourcemap: false,
  },
});
