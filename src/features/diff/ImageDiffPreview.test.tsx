import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import { I18nProvider } from '../../i18n/i18n';
import {
  ImageDiffPreview,
  ImagePreviewToggle,
  imagePreviewBackgroundForPixels,
} from './ImageDiffPreview';

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
  it('does not render the preview region while image bytes are pending', () => {
    const workspace = adapter();
    workspace.query = vi.fn<WorkspaceAdapter['query']>(
      async () => await new Promise<never>(() => {}),
    );
    render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={workspace}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'new.png',
            area: 'untracked',
            generation: 1,
            diffId: 'diff-loading',
          }}
          candidate={{ path: 'new.png', changeKind: 'added', format: 'binary' }}
        />
      </I18nProvider>,
    );

    expect(screen.queryByLabelText('Image preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

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
    expect(screen.getByLabelText('Image preview')).toHaveAttribute('data-layout', 'split');
    expect(before.closest('figure')).toHaveAttribute('data-side', 'before');
    expect(after.closest('figure')).toHaveAttribute('data-side', 'after');
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(workspace.query).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('chooses a contrasting background while ignoring transparent pixels', () => {
    expect(
      imagePreviewBackgroundForPixels(Uint8ClampedArray.from([255, 255, 255, 0, 0, 0, 0, 255])),
    ).toBe('light');
    expect(
      imagePreviewBackgroundForPixels(Uint8ClampedArray.from([0, 0, 0, 0, 255, 255, 255, 255])),
    ).toBe('dark');
    expect(imagePreviewBackgroundForPixels(Uint8ClampedArray.from([0, 0, 0, 0]))).toBeUndefined();
  });

  it('renders images over a checkerboard surface', async () => {
    render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={adapter()}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'new.png',
            area: 'untracked',
            generation: 1,
            diffId: 'diff-checkerboard',
          }}
          candidate={{ path: 'new.png', changeKind: 'added', format: 'binary' }}
        />
      </I18nProvider>,
    );

    expect((await screen.findByAltText('Image: new.png')).parentElement).toHaveClass(
      'image-diff-image-surface',
    );
  });

  it('falls back to the binary message when neither side decodes', async () => {
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
            path: 'data.bin',
            diffId: 'diff-2',
          }}
          candidate={{
            path: 'data.bin',
            changeKind: 'modified',
            format: 'binary',
          }}
          onProbeResult={onProbeResult}
        />
      </I18nProvider>,
    );

    expect(
      await screen.findByText('Binary files can be managed only as whole files.'),
    ).toBeVisible();
    expect(onProbeResult).toHaveBeenCalledWith(false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2));
  });

  it('uses the inline image preview layout when selected', async () => {
    render(
      <I18nProvider language="en">
        <ImageDiffPreview
          adapter={adapter()}
          repoId="repo-1"
          target={{
            kind: 'changes',
            path: 'new.png',
            previousPath: 'old.png',
            area: 'staged',
            generation: 1,
            diffId: 'diff-inline',
          }}
          candidate={{
            path: 'new.png',
            previousPath: 'old.png',
            changeKind: 'renamed',
            format: 'binary',
          }}
          layout="unified"
        />
      </I18nProvider>,
    );

    expect(await screen.findByLabelText('Image preview')).toHaveAttribute('data-layout', 'unified');
  });

  it.each(['split', 'unified'] as const)(
    'shows an added image without comparison labels in the %s layout',
    async (layout) => {
      render(
        <I18nProvider language="en">
          <ImageDiffPreview
            adapter={adapter()}
            repoId="repo-1"
            target={{
              kind: 'changes',
              path: 'new.png',
              area: 'untracked',
              generation: 1,
              diffId: `diff-added-${layout}`,
            }}
            candidate={{ path: 'new.png', changeKind: 'added', format: 'binary' }}
            layout={layout}
          />
        </I18nProvider>,
      );

      const image = await screen.findByAltText('Image: new.png');
      expect(image.closest('.image-diff-preview')).toHaveAttribute('data-single-side', 'true');
      expect(screen.queryByText('Before')).not.toBeInTheDocument();
      expect(screen.queryByText('After')).not.toBeInTheDocument();
    },
  );

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
    expect(await screen.findByAltText('Image: new.png')).toBeVisible();

    await act(async () => resolveOld({ kind: 'imageBytes', bytes: Uint8Array.from([1]) }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Image: old.png')).not.toBeInTheDocument();
  });

  it('keeps the current image and captions visible until the next image is decoded', async () => {
    const workspace = adapter();
    const oldProps = {
      adapter: workspace,
      repoId: 'repo-1',
      target: {
        kind: 'changes' as const,
        path: 'old.svg',
        previousPath: 'before-old.svg',
        area: 'unstaged' as const,
        generation: 1,
        diffId: 'old-diff',
      },
      candidate: {
        path: 'old.svg',
        previousPath: 'before-old.svg',
        changeKind: 'renamed' as const,
        format: 'svg' as const,
      },
    };
    const nextProps = {
      ...oldProps,
      target: { ...oldProps.target, path: 'new.svg', generation: 2, diffId: 'new-diff' },
      candidate: { path: 'new.svg', changeKind: 'added' as const, format: 'svg' as const },
    };
    const view = render(
      <I18nProvider language="en">
        <ImageDiffPreview {...oldProps} />
      </I18nProvider>,
    );

    const oldImage = await screen.findByAltText('After image: old.svg');
    let finishDecode!: () => void;
    decodeImage.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );

    view.rerender(
      <I18nProvider language="en">
        <ImageDiffPreview {...nextProps} hidden />
      </I18nProvider>,
    );

    await waitFor(() => expect(workspace.query).toHaveBeenCalledTimes(3));
    expect(screen.getByAltText('After image: old.svg')).toBe(oldImage);
    expect(screen.getByText('before-old.svg')).toBeVisible();
    expect(screen.getByText('old.svg')).toBeVisible();
    expect(screen.queryByAltText('Image: new.svg')).not.toBeInTheDocument();

    await act(async () => finishDecode());
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1'));
    view.rerender(
      <I18nProvider language="en">
        <ImageDiffPreview {...nextProps} />
      </I18nProvider>,
    );
    expect(await screen.findByAltText('Image: new.svg')).toBeVisible();
    expect(screen.queryByAltText('After image: old.svg')).not.toBeInTheDocument();
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
    const options = button.querySelectorAll('.toggle-button-option');
    expect(button).toHaveClass('toggle-button', 'image-preview-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveClass('is-selected');
    expect(options[0]?.querySelector('.lucide-image')).toBeInTheDocument();
    expect(options[1]).not.toHaveClass('is-selected');
    expect(options[1]?.querySelector('.lucide-image-off')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Toggle image preview');
    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(false);
  });
});
