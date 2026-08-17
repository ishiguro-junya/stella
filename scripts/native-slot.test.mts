import { mkdir, mkdtemp, readlink, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, test } from 'vitest';

import { acquireNativeSlot } from './native-slot.mts';

const temporaryDirectories: string[] = [];

async function temporaryLockPath(): Promise<string> {
  await mkdir('tmp', { recursive: true });
  const directory = await mkdtemp(resolve('tmp', 'native-slot-'));
  temporaryDirectories.push(directory);
  return join(directory, 'lock');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('acquireNativeSlot', () => {
  test('waits until the active slot is released', async () => {
    const lockPath = await temporaryLockPath();
    const releaseFirst = await acquireNativeSlot(lockPath);
    let acquiredSecond = false;
    const second = acquireNativeSlot(lockPath, () => undefined).then((release) => {
      acquiredSecond = true;
      return release;
    });

    await delay(50);
    expect(acquiredSecond).toBe(false);
    await releaseFirst();

    const releaseSecond = await second;
    expect(acquiredSecond).toBe(true);
    await releaseSecond();
  });

  test('replaces a stale slot', async () => {
    const lockPath = await temporaryLockPath();
    await symlink('999999999', lockPath);

    const release = await acquireNativeSlot(lockPath);
    expect(await readlink(lockPath)).toBe(String(process.pid));
    await release();
  });
});
