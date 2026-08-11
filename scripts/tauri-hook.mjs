import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const mode = process.argv[2];
const executable = (name) => resolve(repositoryRoot, 'node_modules', '.bin', name);
run(process.execPath, ['scripts/toolchain.mjs', 'verify']);
if (mode === 'dev') run(executable('vite'), []);
else if (mode === 'build') {
  run(executable('tsc'), ['-b']);
  run(executable('vite'), ['build']);
} else throw new Error('usage: node scripts/tauri-hook.mjs <dev|build>');
