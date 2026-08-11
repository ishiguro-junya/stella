import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { appCleanup, appMount, appRender, workerPoolCleanup, workerPoolMount } = vi.hoisted(() => ({
  appCleanup: vi.fn<() => void>(),
  appMount: vi.fn<() => void>(),
  appRender: vi.fn<() => void>(),
  workerPoolCleanup: vi.fn<() => void>(),
  workerPoolMount: vi.fn<() => void>(),
}));

vi.mock('./App', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react');
  return {
    App: () => {
      appRender();
      useEffect(() => {
        appMount();
        return appCleanup;
      }, []);
      return <div />;
    },
  };
});

vi.mock('./features/diff/DiffSurface', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react');
  return {
    DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => {
      useEffect(() => {
        workerPoolMount();
        return workerPoolCleanup;
      }, []);
      return children;
    },
  };
});

import { AppRoot } from './AppRoot';

describe('AppRoot', () => {
  it('StrictModeの再マウント対象からDiff worker poolを除外する', () => {
    const view = render(<AppRoot />);

    expect(appRender).toHaveBeenCalledTimes(2);
    expect(appMount).toHaveBeenCalledTimes(1);
    expect(appCleanup).not.toHaveBeenCalled();
    expect(workerPoolMount).toHaveBeenCalledTimes(1);
    expect(workerPoolCleanup).not.toHaveBeenCalled();

    view.unmount();
    expect(workerPoolCleanup).toHaveBeenCalledTimes(1);
  });
});
