import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauriMock, setThemeMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn<() => boolean>(),
  setThemeMock: vi.fn<(theme: 'light' | 'dark' | null) => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: isTauriMock }));
vi.mock('@tauri-apps/api/app', () => ({ setTheme: setThemeMock }));

import { applyAppearance, applyNativeAppearance } from './appearance';

beforeEach(() => {
  isTauriMock.mockReset();
  setThemeMock.mockReset();
});

describe('appearance synchronization', () => {
  it('applies fixed themes and restores live system CSS selection', () => {
    applyAppearance('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    applyAppearance('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    applyAppearance('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('synchronizes Tauri chrome and treats native failures as non-blocking', async () => {
    isTauriMock.mockReturnValue(true);
    setThemeMock.mockResolvedValueOnce(undefined);
    await expect(applyNativeAppearance('system')).resolves.toBeUndefined();
    expect(setThemeMock).toHaveBeenLastCalledWith(null);

    setThemeMock.mockRejectedValueOnce(new Error('native theme unavailable'));
    await expect(applyNativeAppearance('dark')).resolves.toBeUndefined();
    expect(setThemeMock).toHaveBeenLastCalledWith('dark');
  });

  it('does not call the native API in a browser', async () => {
    isTauriMock.mockReturnValue(false);
    await applyNativeAppearance('light');
    expect(setThemeMock).not.toHaveBeenCalled();
  });
});
