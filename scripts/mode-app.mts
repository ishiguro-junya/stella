import { spawn } from 'node:child_process';
import { link, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
const buildLock = resolve('target', '.stella-mode-build.lock');

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function acquireBuildLock(): Promise<void> {
  await mkdir(dirname(buildLock), { recursive: true });
  // 別プロセスが構築とリンクを完了するまで、同じロックを直列に確認する。
  /* oxlint-disable no-await-in-loop */
  while (true) {
    try {
      await symlink(String(process.pid), buildLock);
      return;
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
    }

    const owner = Number(await readlink(buildLock).catch(() => ''));
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        await delay(100);
        continue;
      } catch (error) {
        if (!hasErrorCode(error, 'ESRCH')) throw error;
      }
    }

    const staleLock = `${buildLock}.stale-${process.pid}-${Date.now()}`;
    try {
      await rename(buildLock, staleLock);
      await rm(staleLock, { force: true });
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
  }
  /* oxlint-enable no-await-in-loop */
}

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
  await acquireBuildLock();
  try {
    process.exitCode = await run(command, process.argv.slice(5));
    if (process.exitCode === 0) await linkExecutable();
  } finally {
    await rm(buildLock, { force: true });
  }
}
