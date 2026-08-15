import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { I18nProvider } from '../../i18n/i18n';
import { ImageDiffPreview, ImagePreviewToggle } from './ImageDiffPreview';

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const decodeImage = vi.fn<() => Promise<void>>();

function adapter(): WorkspaceAdapter {
  return {
    attach: vi.fn<WorkspaceAdapter['attach']>(async () => ({ repos: [], activities: [] })),
    query: vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind !== 'imageBytes') return { kind: 'activity', entries: [] };
      return {
        kind: 'imageBytes',
        bytes: Uint8Array.from(request.side === 'before' ? [1] : [2]),
      };
    }),
    preview: vi.fn<WorkspaceAdapter['preview']>(async () => {
      throw new Error('unused');
    }),
    execute: vi.fn<WorkspaceAdapter['execute']>(async () => {
      throw new Error('unused');
    }),
    cancel: vi.fn<WorkspaceAdapter['cancel']>(async () => undefined),
    subscribe: vi.fn<WorkspaceAdapter['subscribe']>(async () => () => undefined),
  };
}

beforeEach(() => {
  createObjectURL.mockReset();
  createObjectURL.mockImplementation((_blob) => `blob:image-${createObjectURL.mock.calls.length}`);
  revokeObjectURL.mockReset();
  decodeImage.mockReset();
  decodeImage.mockResolvedValue(undefined);
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = decodeImage;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageDiffPreview', () => {
  it('decodes and displays before then after while releasing both Blob URLs', async () => {
    const workspace = adapter();
    const view = render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={workspace}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'new.png',
            previousPath: 'old.png',
            area: 'staged',
            generation: 1,
            diffId: 'diff-1',
          }}
          candidate={{
            path: 'new.png',
            previousPath: 'old.png',
            changeKind: 'renamed',
            format: 'binary',
          }}
        />
      </I18nProvider>,
    );

    const before = await screen.findByAltText('Before image: old.png');
    const after = await screen.findByAltText('After image: new.png');
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(workspace.query).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('falls back to the binary message when neither side decodes', async () => {
    decodeImage.mockRejectedValue(new Error('not an image'));
    render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={adapter()}
          repoId="repo-1"
          target={{
            kind: 'commit',
            oid: 'abc',
            path: 'data.bin',
            diffId: 'diff-2',
          }}
          candidate={{
            path: 'data.bin',
            changeKind: 'modified',
            format: 'binary',
          }}
        />
      </I18nProvider>,
    );

    expect(
      await screen.findByText('Binary files can be managed only as whole files.'),
    ).toBeVisible();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2));
  });

  it('ignores an old response after the selected image changes', async () => {
    let resolveOld!: (value: { kind: 'imageBytes'; bytes: Uint8Array }) => void;
    let resolveNew!: (value: { kind: 'imageBytes'; bytes: Uint8Array }) => void;
    const oldResponse = new Promise<{ kind: 'imageBytes'; bytes: Uint8Array }>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<{ kind: 'imageBytes'; bytes: Uint8Array }>((resolve) => {
      resolveNew = resolve;
    });
    const workspace = adapter();
    workspace.query = vi.fn<WorkspaceAdapter['query']>(async (request) => {
      if (request.kind !== 'imageBytes') return { kind: 'activity', entries: [] };
      return request.target.path === 'old.png' ? oldResponse : newResponse;
    });
    const view = render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={workspace}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'old.png',
            area: 'untracked',
            generation: 1,
            diffId: 'old-diff',
          }}
          candidate={{ path: 'old.png', changeKind: 'added', format: 'binary' }}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(workspace.query).toHaveBeenCalledTimes(1));

    view.rerender(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={workspace}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'new.png',
            area: 'untracked',
            generation: 2,
            diffId: 'new-diff',
          }}
          candidate={{ path: 'new.png', changeKind: 'added', format: 'binary' }}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(workspace.query).toHaveBeenCalledTimes(2));
    await act(async () => resolveNew({ kind: 'imageBytes', bytes: Uint8Array.from([2]) }));
    expect(await screen.findByAltText('After image: new.png')).toBeVisible();

    await act(async () => resolveOld({ kind: 'imageBytes', bytes: Uint8Array.from([1]) }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('After image: old.png')).not.toBeInTheDocument();
  });

  it('probes a pure rename without displaying it until WebKit decodes the image', async () => {
    const workspace = adapter();
    const onProbeResult = vi.fn<(previewable: boolean) => void>();
    const props = {
      adapter: workspace,
      repoId: 'repo-1',
      target: {
        kind: 'commit' as const,
        oid: 'abc',
        path: 'new.png',
        previousPath: 'old.png',
        diffId: 'rename-diff',
      },
      candidate: {
        path: 'new.png',
        previousPath: 'old.png',
        changeKind: 'renamed' as const,
        format: 'probe' as const,
      },
      onProbeResult,
    };
    const view = render(
      <I18nProvider language="en">
        <ImageDiffPreview {...props} hidden />
      </I18nProvider>,
    );

    await waitFor(() => expect(onProbeResult).toHaveBeenCalledWith(true));
    expect(screen.queryByLabelText('Image preview')).not.toBeInTheDocument();
    expect(workspace.query).toHaveBeenCalledTimes(2);

    view.rerender(
      <I18nProvider language="en">
        <ImageDiffPreview {...props} />
      </I18nProvider>,
    );
    expect(await screen.findByAltText('Before image: old.png')).toBeVisible();
    expect(workspace.query).toHaveBeenCalledTimes(2);
  });

  it('rejects a pure rename when WebKit cannot decode either side', async () => {
    decodeImage.mockRejectedValue(new Error('not an image'));
    const onProbeResult = vi.fn<(previewable: boolean) => void>();
    render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={adapter()}
          repoId="repo-1"
          target={{
            kind: 'commit',
            oid: 'abc',
            path: 'new.bin',
            previousPath: 'old.bin',
            diffId: 'rename-diff',
          }}
          candidate={{
            path: 'new.bin',
            previousPath: 'old.bin',
            changeKind: 'renamed',
            format: 'probe',
          }}
          onProbeResult={onProbeResult}
          hidden
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(onProbeResult).toHaveBeenCalledWith(false));
    expect(screen.queryByLabelText('Image preview')).not.toBeInTheDocument();
  });

  it('exposes one pressed image button instead of a select control', () => {
    const onPressedChange = vi.fn<(pressed: boolean) => void>();
    render(
      <I18nProvider language="en">
        <ImagePreviewToggle pressed onPressedChange={onPressedChange} />
      </I18nProvider>,
    );

    const button = screen.getByRole('button', { name: 'Image preview' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(false);
  });
});
