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
          healthIssues={[]}
          loading={false}
          busy={false}
          onDismiss={() => setOpen(false)}
          onReload={() => undefined}
          onFetch={() => undefined}
          onChangeUrl={() => undefined}
        />
      ) : null}
    </I18nProvider>
  );
}

describe('RemoteManagerDialog', () => {
  it('shows every fetch and push URL and submits an explicit URL replacement', async () => {
    const user = userEvent.setup();
    const onChangeUrl = vi.fn<RemoteManagerDialogProps['onChangeUrl']>();
    const onFetch = vi.fn<RemoteManagerDialogProps['onFetch']>();
    render(
      <RemoteManagerDialog
        remotes={[
          {
            name: 'origin',
            fetchUrls: ['https://example.test/repo.git', 'https://mirror.test/repo.git'],
            pushUrls: ['ssh://example.test/repo.git'],
          },
        ]}
        healthIssues={[{ kind: 'remote', remote: 'origin', reason: 'network' }]}
        loading={false}
        busy={false}
        onDismiss={() => undefined}
        onReload={() => undefined}
        onFetch={onFetch}
        onChangeUrl={onChangeUrl}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Remote URLs' });
    expect(dialog).toHaveTextContent('https://example.test/repo.git');
    expect(dialog).toHaveTextContent('https://mirror.test/repo.git');
    expect(dialog).toHaveTextContent('ssh://example.test/repo.git');
    expect(dialog).toHaveTextContent('Check connection');

    await user.click(within(dialog).getByRole('button', { name: 'Fetch' }));
    expect(onFetch).toHaveBeenCalledWith('origin');
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Change a URL for origin' })[0]!,
    );
    const input = within(dialog).getByRole('textbox', { name: 'New remote URL' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'https://example.test/new.git');
    await user.click(within(dialog).getByRole('button', { name: 'Review Change' }));
    expect(onChangeUrl).toHaveBeenCalledWith({
      remote: 'origin',
      urlKind: 'fetch',
      expectedUrl: 'https://example.test/repo.git',
      newUrl: 'https://example.test/new.git',
    });
  });

  it('renders Japanese recovery copy and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(<JapaneseRemoteManagerHost />);
    const opener = screen.getByRole('button', { name: '元の操作' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'リモートURL' })).toHaveTextContent(
      'リモートが設定されていません。',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
