import { createServer, type Server } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { reserveAvailablePort, type PortReservation } from './available-port.mts';

const servers: Server[] = [];
const reservations: PortReservation[] = [];
const temporaryDirectories: string[] = [];

async function occupyPort(host = '127.0.0.1'): Promise<number> {
  for (let port = 55_000; port <= 55_100; port += 1) {
    const server = createServer();
    try {
      // 使用中のポートだけを飛ばして待受用ポートを確保する。
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      servers.push(server);
      return port;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }
  throw new Error('Could not acquire a test port.');
}

async function releasePorts(): Promise<void> {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
}

async function temporaryReservationDirectory(): Promise<string> {
  await mkdir('tmp', { recursive: true });
  const directory = await mkdtemp(resolvePath('tmp', 'available-port-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function selectPort(
  options: Omit<Parameters<typeof reserveAvailablePort>[0], 'reservationDirectory'>,
  reservationDirectory?: string,
): Promise<number> {
  const reservation = await reserveAvailablePort({
    ...options,
    reservationDirectory: reservationDirectory ?? (await temporaryReservationDirectory()),
  });
  reservations.push(reservation);
  return reservation.port;
}

afterEach(async () => {
  await Promise.all(reservations.splice(0).map(({ release }) => release()));
  await releasePorts();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('reserveAvailablePort', () => {
  test('selects the first available port in the range', async () => {
    const port = await occupyPort();
    await releasePorts();

    await expect(
      selectPort({ label: 'test', start: port, end: port, explicitPort: undefined }),
    ).resolves.toBe(port);
  });

  test('skips a port occupied on IPv4', async () => {
    const port = await occupyPort();

    await expect(
      selectPort({
        label: 'test',
        start: port,
        end: port + 20,
        explicitPort: undefined,
      }),
    ).resolves.toBeGreaterThan(port);
  });

  test('skips a port occupied on IPv6', async () => {
    const port = await occupyPort('::1');

    await expect(
      selectPort({
        label: 'test',
        start: port,
        end: port + 20,
        explicitPort: undefined,
      }),
    ).resolves.toBeGreaterThan(port);
  });

  test('fails when the range is exhausted', async () => {
    const port = await occupyPort();

    await expect(
      selectPort({ label: 'test', start: port, end: port, explicitPort: undefined }),
    ).rejects.toThrow(`${port}-${port}`);
  });

  test('uses only the explicitly configured port', async () => {
    const port = await occupyPort();
    await releasePorts();

    await expect(
      selectPort({ label: 'test', start: 1, end: 1, explicitPort: String(port) }),
    ).resolves.toBe(port);
  });

  test('fails when the explicitly configured port is occupied', async () => {
    const port = await occupyPort();

    await expect(
      selectPort({ label: 'test', start: 1, end: 1, explicitPort: String(port) }),
    ).rejects.toThrow('already in use');
  });

  test.each(['', '0', '65536', 'abc', '1.5'])('rejects invalid explicit port %s', async (port) => {
    await expect(
      selectPort({ label: 'test', start: 1, end: 1, explicitPort: port }),
    ).rejects.toThrow('between 1 and 65535');
  });

  test('keeps the selected port reserved until release', async () => {
    const port = await occupyPort();
    await releasePorts();
    const reservationDirectory = await temporaryReservationDirectory();

    await expect(
      selectPort(
        { label: 'test', start: port, end: port + 20, explicitPort: undefined },
        reservationDirectory,
      ),
    ).resolves.toBe(port);
    await expect(
      selectPort(
        { label: 'test', start: port, end: port + 20, explicitPort: undefined },
        reservationDirectory,
      ),
    ).resolves.toBeGreaterThan(port);
  });
});
