import { spawn } from 'node:child_process';
import { link, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const mode = process.argv[2];
const source = process.argv[3];
const names = {
  dev: 'Stella (DEV)',
  e2e: 'Stella (E2E)',
  vrt: 'Stella (VRT)',
  scr: 'Stella (SCR)',
} as const;
if ((mode !== 'dev' && mode !== 'e2e' && mode !== 'vrt' && mode !== 'scr') || !source) {
  throw new Error('Usage: mode-app.mts <dev|e2e|vrt|scr> <executable> [...args]');
}

const name = names[mode];
const executable = resolve(source);
const namedExecutable = join(dirname(executable), name);

async function run(command: string, args: string[]): Promise<number> {
  const child = spawn(command, args, { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  return new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

async function linkExecutable(): Promise<void> {
  // macOSのDock名には実行ファイル名が使われるため、起動種別ごとの名前でハードリンクを作る。
  await rm(namedExecutable, { force: true });
  await link(executable, namedExecutable);
}

if (mode === 'dev') {
  await linkExecutable();
  process.exitCode = await run(namedExecutable, process.argv.slice(4));
} else {
  const command = process.argv[4];
  if (!command) {
    throw new Error('Build command is required for e2e, vrt, and scr modes.');
  }
  process.exitCode = await run(command, process.argv.slice(5));
  if (process.exitCode === 0) await linkExecutable();
}
