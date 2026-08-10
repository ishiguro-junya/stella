import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from './adapters/workspaceAdapter';

const { createAdapterMock } = vi.hoisted(() => ({
  createAdapterMock: vi.fn<() => WorkspaceAdapter>(),
}));

vi.mock('./adapters/tauriWorkspaceAdapter', () => ({
  createTauriWorkspaceAdapter: createAdapterMock,
}));
vi.mock('./features/diff/DiffSurface', () => ({ DiffSurface: () => <div>Diff</div> }));
vi.mock('./features/conflict/ConflictResultEditor', () => ({
  ConflictResultEditor: () => <div>Editor</div>,
}));

import { App } from './App';

describe('App default adapter lifecycle', () => {
  it('creates the Tauri adapter once across React rerenders', async () => {
    const adapter: WorkspaceAdapter = {
      attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
      query: vi.fn<WorkspaceAdapter['query']>(async () => ({
        kind: 'activity' as const,
        entries: [],
      })),
      preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
        throw new Error('unused');
      }),
      execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
        throw new Error('unused');
      }),
      cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
      subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
    };
    createAdapterMock.mockReturnValue(adapter);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('combobox', { name: 'Theme' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(createAdapterMock).toHaveBeenCalledTimes(1);
    expect(adapter.subscribe).toHaveBeenCalledTimes(1);
  });
});
