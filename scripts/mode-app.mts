import { spawn } from 'node:child_process';
import { link, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const mode = process.argv[2];
const source = process.argv[3];
if ((mode !== 'dev' && mode !== 'test-link') || !source) {
  throw new Error('使い方: mode-app.mts <dev|test-link> <executable> [...args]');
}

const name = mode === 'dev' ? 'Stella (DEV)' : 'Stella (TEST)';
const executable = resolve(source);
const namedExecutable = join(dirname(executable), name);
// macOSのDock名には実行ファイル名が使われるため、起動種別ごとの名前でハードリンクを作ります。
await rm(namedExecutable, { force: true });
await link(executable, namedExecutable);

if (mode === 'dev') {
  const child = spawn(namedExecutable, process.argv.slice(4), { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  process.exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}
