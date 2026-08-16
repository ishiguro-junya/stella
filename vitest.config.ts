import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./app/test/setup.ts'],
    include: ['app/**/*.{test,spec}.{ts,tsx}', '.markdownlint-rules/**/*.test.mts'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});
