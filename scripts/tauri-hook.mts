import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureDevelopmentShowcaseRemote,
  resetDevelopmentShowcaseFixture,
} from '../tests/e2e/support/showcaseRepository.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const developmentRepositoryPath = join(repositoryRoot, '.tmp', 'dev', 'major-league-baseball');

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function prepareDevelopmentRepository(): Promise<void> {
  if (!(await exists(join(developmentRepositoryPath, '.git'))))
    await resetDevelopmentShowcaseFixture();
  else await ensureDevelopmentShowcaseRemote();
  process.env.VITE_DEV_REPOSITORY_PATH = developmentRepositoryPath;
}

const mode = process.argv[2];
const executable = (name: string) => resolve(repositoryRoot, 'node_modules', '.bin', name);
run(process.execPath, ['--import', 'tsx', 'scripts/toolchain.mts', 'verify']);
if (mode === 'dev') {
  await prepareDevelopmentRepository();
  run(executable('vite'), []);
} else if (mode === 'build') {
  run(executable('tsc'), ['-b']);
  run(executable('vite'), ['build']);
} else throw new Error('usage: node --import tsx scripts/tauri-hook.mts <dev|build>');
