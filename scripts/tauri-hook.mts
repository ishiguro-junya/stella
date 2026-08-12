import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const mode = process.argv[2];
const executable = (name: string) => resolve(repositoryRoot, 'node_modules', '.bin', name);
run(process.execPath, ['--import', 'tsx', 'scripts/toolchain.mts', 'verify']);
if (mode === 'dev') run(executable('vite'), []);
else if (mode === 'build') {
  run(executable('tsc'), ['-b']);
  run(executable('vite'), ['build']);
} else throw new Error('usage: node --import tsx scripts/tauri-hook.mts <dev|build>');
