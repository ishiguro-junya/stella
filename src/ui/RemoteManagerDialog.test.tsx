import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/i18n';
import { RemoteManagerDialog, type RemoteManagerDialogProps } from './RemoteManagerDialog';

function JapaneseRemoteManagerHost() {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider language="ja">
      <button type="button" onClick={() => setOpen(true)}>
        元の操作
      </button>
      {open ? (
        <RemoteManagerDialog
          remotes={[]}
          loading={false}
          busy={false}
          onDismiss={() => setOpen(false)}
          onReload={() => undefined}
          onSave={() => undefined}
        />
      ) : null}
    </I18nProvider>
  );
}

describe('RemoteManagerDialog', () => {
  it('keeps loaded URLs in place without showing loading copy during a reload', () => {
    render(
      <RemoteManagerDialog
        remotes={[
          {
            name: 'origin',
            fetchUrls: ['https://example.test/repo.git'],
            pushUrls: [],
          },
        ]}
        loading
        busy={false}
        onDismiss={() => undefined}
        onReload={() => undefined}
        onSave={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Remote URLs' });
    expect(dialog.querySelector('.dialog-body')).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('textbox')).toHaveValue('https://example.test/repo.git');
    expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows every URL as an input and saves all changed URLs together', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<RemoteManagerDialogProps['onSave']>();
    render(
      <RemoteManagerDialog
        remotes={[
          {
            name: 'origin',
            fetchUrls: ['https://example.test/repo.git', 'https://mirror.test/repo.git'],
            pushUrls: ['ssh://example.test/repo.git'],
          },
        ]}
        loading={false}
        busy={false}
        onDismiss={() => undefined}
        onReload={() => undefined}
        onSave={onSave}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Remote URLs' });
    expect(dialog).not.toHaveTextContent('origin');
    expect(within(dialog).queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument();
    const inputs = within(dialog).getAllByRole('textbox');
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toHaveFocus();
    expect(inputs.map((input) => input.getAttribute('value'))).toEqual([
      'https://example.test/repo.git',
      'https://mirror.test/repo.git',
      'ssh://example.test/repo.git',
    ]);
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.clear(inputs[0]!);
    expect(save).toBeDisabled();
    await user.type(inputs[0]!, 'https://example.test/new.git');
    await user.clear(inputs[2]!);
    await user.type(inputs[2]!, 'ssh://example.test/new.git');
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith([
      {
        remote: 'origin',
        urlKind: 'fetch',
        expectedUrl: 'https://example.test/repo.git',
        newUrl: 'https://example.test/new.git',
      },
      {
        remote: 'origin',
        urlKind: 'push',
        expectedUrl: 'ssh://example.test/repo.git',
        newUrl: 'ssh://example.test/new.git',
      },
    ]);
  });

  it('renders Japanese recovery copy and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(<JapaneseRemoteManagerHost />);
    const opener = screen.getByRole('button', { name: '元の操作' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'リモートURLを変更' })).toHaveTextContent(
      'リモートが設定されていません。',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
