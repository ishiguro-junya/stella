import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string) => Promise<void>>(),
  isTauriMock: vi.fn<() => boolean>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: isTauriMock }));

import { openFilesAndFoldersSystemSettings } from './systemSettings';

beforeEach(() => {
  invokeMock.mockReset();
  isTauriMock.mockReset();
});

describe('macOS system Settings contract', () => {
  it('opens the Files and Folders privacy settings through Tauri', async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);

    await openFilesAndFoldersSystemSettings();

    expect(invokeMock).toHaveBeenCalledWith('open_files_and_folders_settings');
  });

  it('is a no-op outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);

    await openFilesAndFoldersSystemSettings();

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
