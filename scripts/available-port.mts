import { createServer } from 'node:net';
import { mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { commonGitDirectory } from './native-slot.mts';

type PortSelection = {
  label: string;
  start: number;
  end: number;
  explicitPort: string | undefined;
  reservationDirectory?: string;
};

export type PortReservation = {
  port: number;
  release: () => Promise<void>;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function parsePort(value: string, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer port between 1 and 65535: ${value}`);
  }
  return port;
}

async function isHostAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: Error & { code?: string }) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

async function isAvailable(port: number): Promise<boolean> {
  if (!(await isHostAvailable(port, '127.0.0.1'))) return false;
  return isHostAvailable(port, '::1');
}

async function reserve(
  port: number,
  directory: string,
): Promise<(() => Promise<void>) | undefined> {
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `stella-port-${port}.lock`);

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
        return undefined;
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

async function reserveIfAvailable(
  port: number,
  reservationDirectory: string,
): Promise<PortReservation | undefined> {
  const release = await reserve(port, reservationDirectory);
  if (!release) return undefined;
  try {
    if (await isAvailable(port)) return { port, release };
    await release();
    return undefined;
  } catch (error) {
    await release();
    throw error;
  }
}

export async function reserveAvailablePort({
  label,
  start,
  end,
  explicitPort,
  reservationDirectory = commonGitDirectory(),
}: PortSelection): Promise<PortReservation> {
  if (explicitPort !== undefined) {
    const port = parsePort(explicitPort, label);
    const reservation = await reserveIfAvailable(port, reservationDirectory);
    if (reservation) return reservation;
    throw new Error(`${label} port ${port} is already in use.`);
  }

  for (let port = start; port <= end; port += 1) {
    // 範囲の先頭から選ぶため、ポートは順番に確認する。
    // oxlint-disable-next-line no-await-in-loop
    const reservation = await reserveIfAvailable(port, reservationDirectory);
    if (reservation) return reservation;
  }
  throw new Error(`No available port for ${label} in range ${start}-${end}.`);
}
