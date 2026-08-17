import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function acquireNativeSlot(
  lockPath: string,
  onWait: (owner: number) => void = (owner) =>
    console.log(`Waiting for native execution slot held by PID ${owner}...`),
): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true });
  let waiting = false;

  /* oxlint-disable no-await-in-loop */
  while (true) {
    try {
      await symlink(String(process.pid), lockPath);
      return async () => {
        if ((await readlink(lockPath).catch(() => '')) === String(process.pid)) {
          await rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error;
    }

    const owner = Number(await readlink(lockPath).catch(() => ''));
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        if (!waiting) {
          onWait(owner);
          waiting = true;
        }
        await delay(250);
        continue;
      } catch (error) {
        if (!hasErrorCode(error, 'ESRCH')) throw error;
      }
    }

    const staleLock = `${lockPath}.stale-${process.pid}-${Date.now()}`;
    try {
      await rename(lockPath, staleLock);
      await rm(staleLock, { force: true });
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
  }
  /* oxlint-enable no-await-in-loop */
}

export function commonGitDirectory(): string {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Could not resolve the Git common directory.');
  }
  return result.stdout.trim();
}

async function run(command: string, args: string[], cargoJobs: string): Promise<number> {
  const child = spawn(command, args, {
    env: { ...process.env, CARGO_BUILD_JOBS: cargoJobs },
    stdio: 'inherit',
  });
  const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  try {
    return await new Promise<number>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    });
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Usage: native-slot.mts <command> [...args]');

  const cargoJobs = process.env.CARGO_BUILD_JOBS ?? '2';
  const release = await acquireNativeSlot(join(commonGitDirectory(), 'stella-native.lock'));
  console.log(`Native execution slot acquired (Cargo jobs: ${cargoJobs}).`);
  try {
    process.exitCode = await run(command, args, cargoJobs);
  } finally {
    await release();
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
