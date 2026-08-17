import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDevelopmentShowcaseFixtures } from '../app/test/e2e/support/showcaseRepository.js';
import { reserveAvailablePort } from './available-port.mts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function prepareDevelopmentRepositories(): Promise<void> {
  const paths = await ensureDevelopmentShowcaseFixtures();
  process.env.VITE_DEV_REPOSITORY_PATHS = JSON.stringify(paths);
}

const mode = process.argv[2];
const executable = (name: string) => resolve(repositoryRoot, 'node_modules', '.bin', name);
if (mode === 'launch-dev') {
  const reservation = await reserveAvailablePort({
    label: 'development app',
    start: 1420,
    end: 1439,
    explicitPort: process.env.STELLA_DEV_PORT,
  });
  const { port } = reservation;
  process.env.STELLA_DEV_PORT = String(port);
  process.env.TAURI_DATA_DIR = resolve(repositoryRoot, 'tmp', 'tauri-data', 'dev');
  process.env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER =
    'node --import tsx ../../scripts/mode-app.mts dev';
  console.log(`Development app port: ${port}`);
  try {
    run(executable('tauri'), [
      'dev',
      '--config',
      'app/native/tauri.dev.conf.json',
      '--config',
      JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }),
    ]);
  } finally {
    await reservation.release();
  }
  process.exit(0);
}

run(process.execPath, ['--import', 'tsx', 'scripts/toolchain.mts', 'verify']);
if (mode === 'dev') {
  await prepareDevelopmentRepositories();
  run(executable('vite'), []);
} else if (mode === 'build') {
  run(executable('tsc'), ['-b']);
  run(executable('vite'), ['build']);
} else throw new Error('usage: node --import tsx scripts/tauri-hook.mts <launch-dev|dev|build>');
