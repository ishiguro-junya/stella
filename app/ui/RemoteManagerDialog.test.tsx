import { fireEvent, render, screen, within } from '@testing-library/react';
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
          repositoryName="Stella"
          repositoryPath="/tmp/stella"
          remotes={[]}
          loading={false}
          busy={false}
          onDismiss={() => setOpen(false)}
          onReload={() => undefined}
          onChoosePath={async () => null}
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
        repositoryName="Stella"
        repositoryPath="/tmp/stella"
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
        onChoosePath={async () => null}
        onSave={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Repository Information' });
    const remoteTab = within(dialog).getByRole('tab', { name: 'Remote' });
    fireEvent.click(remoteTab);
    expect(remoteTab).toHaveFocus();
    expect(dialog.querySelector('.dialog-body')).toHaveAttribute('aria-busy', 'true');
    expect(remoteTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Fetch URLs' })).toHaveValue(
      'https://example.test/repo.git',
    );
    expect(within(dialog).queryByText('Loading…')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('status', { name: 'Loading…' })).toHaveClass(
      'remote-manager-loading',
    );
  });

  it('saves the repository name, path, and changed URLs together', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<RemoteManagerDialogProps['onSave']>();
    render(
      <RemoteManagerDialog
        repositoryName="Stella"
        repositoryPath="/tmp/stella"
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
        onChoosePath={async () => '/tmp/moved-stella'}
        onSave={onSave}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Repository Information' });
    expect(within(dialog).queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument();
    const urlInputs = within(dialog).getAllByRole('textbox', { name: /URLs$/u });
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(3);
    expect(urlInputs[0]).toHaveFocus();
    expect(urlInputs.map((input) => input.getAttribute('value'))).toEqual([
      'https://example.test/repo.git',
      'https://mirror.test/repo.git',
      'ssh://example.test/repo.git',
    ]);
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.clear(urlInputs[0]!);
    expect(save).toBeDisabled();
    await user.type(urlInputs[0]!, 'https://example.test/new.git');
    await user.clear(urlInputs[2]!);
    await user.type(urlInputs[2]!, 'ssh://example.test/new.git');
    await user.click(within(dialog).getByRole('tab', { name: 'Local' }));
    const nameInput = within(dialog).getByRole('textbox', { name: 'Repository name' });
    const pathInput = within(dialog).getByRole('textbox', { name: 'Repository path' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Stella Desktop');
    await user.click(within(dialog).getByRole('button', { name: 'Choose Repository' }));
    expect(pathInput).toHaveValue('/tmp/moved-stella');
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith({
      name: 'Stella Desktop',
      path: '/tmp/moved-stella',
      remoteUrlChanges: [
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
      ],
    });
  });

  it('adds origin from the Remote tab when no remote exists', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<RemoteManagerDialogProps['onSave']>();
    render(
      <RemoteManagerDialog
        repositoryName="Stella"
        repositoryPath="/tmp/stella"
        remotes={[]}
        loading={false}
        busy={false}
        onDismiss={() => undefined}
        onReload={() => undefined}
        onChoosePath={async () => null}
        onSave={onSave}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Repository Information' });
    const url = within(dialog).getByRole('textbox', { name: 'Repository URL' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(url).toHaveFocus();
    expect(save).toBeDisabled();
    await user.type(url, 'https://example.test/stella.git');
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith({
      name: 'Stella',
      path: '/tmp/stella',
      remoteUrlChanges: [],
      remoteAddition: {
        remote: 'origin',
        url: 'https://example.test/stella.git',
      },
    });
  });

  it.each(['/tmp/stella-remote.git', 'file:///tmp/stella-remote.git'])(
    'accepts a Git-valid local origin URL: %s',
    async (remoteUrl) => {
      const user = userEvent.setup();
      const onSave = vi.fn<RemoteManagerDialogProps['onSave']>();
      render(
        <RemoteManagerDialog
          repositoryName="Stella"
          repositoryPath="/tmp/stella"
          remotes={[]}
          loading={false}
          busy={false}
          onDismiss={() => undefined}
          onReload={() => undefined}
          onChoosePath={async () => null}
          onSave={onSave}
        />,
      );

      const dialog = screen.getByRole('dialog', { name: 'Change Repository Information' });
      await user.type(within(dialog).getByRole('textbox', { name: 'Repository URL' }), remoteUrl);
      const save = within(dialog).getByRole('button', { name: 'Save' });
      expect(save).toBeEnabled();
      await user.click(save);
      expect(onSave).toHaveBeenCalledWith({
        name: 'Stella',
        path: '/tmp/stella',
        remoteUrlChanges: [],
        remoteAddition: { remote: 'origin', url: remoteUrl },
      });
    },
  );

  it('keeps Local information editable when remote loading failed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<RemoteManagerDialogProps['onSave']>();
    render(
      <RemoteManagerDialog
        repositoryName="Stella"
        repositoryPath="/tmp/stella"
        remotes={[]}
        loading={false}
        error="Could not load remote URLs."
        busy={false}
        onDismiss={() => undefined}
        onReload={() => undefined}
        onChoosePath={async () => null}
        onSave={onSave}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Change Repository Information' });
    expect(within(dialog).getByText('Could not load remote URLs.')).toBeVisible();
    await user.click(within(dialog).getByRole('tab', { name: 'Local' }));
    const name = within(dialog).getByRole('textbox', { name: 'Repository name' });
    await user.clear(name);
    await user.type(name, 'Stella Local');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Stella Local',
      path: '/tmp/stella',
      remoteUrlChanges: [],
    });
  });

  it('renders Japanese recovery copy and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(<JapaneseRemoteManagerHost />);
    const opener = screen.getByRole('button', { name: '元の操作' });
    await user.click(opener);
    expect(
      within(screen.getByRole('dialog', { name: 'リポジトリ情報を変更' })).getByRole('textbox', {
        name: 'リポジトリのURL',
      }),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
