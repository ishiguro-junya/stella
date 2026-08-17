import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./app/test/unit/setup.ts'],
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.test.mts',
      '.markdownlint-rules/**/*.test.mts',
    ],
    exclude: ['app/test/e2e/**'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});
