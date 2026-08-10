import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauriMock, listenMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn<() => boolean>(),
  listenMock: vi.fn<(event: string, handler: () => void) => Promise<() => void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: isTauriMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { listenForOpenSettings, OPEN_SETTINGS_EVENT } from './settingsMenu';

beforeEach(() => {
  isTauriMock.mockReset();
  listenMock.mockReset();
});

describe('native Settings event contract', () => {
  it('subscribes to the stable Tauri event and forwards it', async () => {
    const dispose = vi.fn<() => void>();
    const handler = vi.fn<() => void>();
    let nativeHandler: (() => void) | undefined;
    isTauriMock.mockReturnValue(true);
    listenMock.mockImplementation(async (event, listener) => {
      expect(event).toBe(OPEN_SETTINGS_EVENT);
      nativeHandler = listener;
      return dispose;
    });

    const unlisten = await listenForOpenSettings(handler);
    nativeHandler?.();
    expect(handler).toHaveBeenCalledOnce();
    unlisten();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('is a no-op outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    const unlisten = await listenForOpenSettings(vi.fn());
    unlisten();
    expect(listenMock).not.toHaveBeenCalled();
  });
});
