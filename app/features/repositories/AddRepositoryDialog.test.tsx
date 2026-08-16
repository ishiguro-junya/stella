import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddRepositoryDialog } from './AddRepositoryDialog';

describe('AddRepositoryDialog', () => {
  it('shows Remote first and switches tabs with the keyboard', async () => {
    const user = userEvent.setup();
    const onChoosePath = vi.fn<() => void>();
    const onUrlChange = vi.fn<(url: string) => void>();
    const onSourceChange = vi.fn<(source: 'url' | 'path') => void>();
    render(
      <AddRepositoryDialog
        source="url"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath=""
        remoteName=""
        localName=""
        busy={false}
        onSourceChange={onSourceChange}
        onUrlChange={onUrlChange}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onRemoteNameChange={() => undefined}
        onLocalNameChange={() => undefined}
        onChoosePath={onChoosePath}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    const remoteTab = within(dialog).getByRole('tab', { name: 'Remote' });
    expect(remoteTab).toHaveAttribute('aria-selected', 'true');
    const localTab = within(dialog).getByRole('tab', { name: 'Local' });
    expect(localTab).toHaveAttribute('aria-selected', 'false');
    const url = within(dialog).getByRole('textbox', { name: 'Repository URL' });
    expect(url).not.toHaveAttribute('placeholder');
    const path = within(dialog).getByRole('textbox', { name: 'Repository path' });
    expect(path).toHaveValue('/Users/example/Documents');
    expect(within(dialog).getByRole('button', { name: 'Add Repository' })).toHaveTextContent('Add');
    const picker = within(dialog).getByRole('button', { name: 'Choose Repository' });
    expect(path.parentElement).toContainElement(picker);
    await user.click(picker);
    expect(onChoosePath).toHaveBeenCalledOnce();
    await user.type(url, 'https://example.com/stella.git');
    expect(onUrlChange).toHaveBeenCalled();
    url.focus();
    fireEvent.click(localTab);
    expect(localTab).toHaveFocus();
    remoteTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSourceChange).toHaveBeenCalledWith('path');
  });

  it('shows the icon-only path picker and a separate repository name field', async () => {
    const user = userEvent.setup();
    const onChoosePath = vi.fn<() => void>();
    const onLocalNameChange = vi.fn<(name: string) => void>();
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath="/Users/example/stella"
        remoteName="remote-stella"
        localName=""
        busy={false}
        onSourceChange={() => undefined}
        onUrlChange={() => undefined}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onRemoteNameChange={() => undefined}
        onLocalNameChange={onLocalNameChange}
        onChoosePath={onChoosePath}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add Repository' });
    const path = within(dialog).getByRole('textbox', { name: 'Repository path' });
    const name = within(dialog).getByRole('textbox', { name: 'Repository name' });
    expect(path).not.toHaveAttribute('placeholder');
    expect(name).not.toHaveAttribute('placeholder');
    expect(within(dialog).getByRole('button', { name: 'Add Repository' })).toHaveTextContent('Add');
    const picker = within(dialog).getByRole('button', { name: 'Choose Repository' });
    expect(path.parentElement).toContainElement(picker);
    expect(picker).not.toHaveTextContent(/Finder|Choose/u);
    await user.click(picker);
    expect(onChoosePath).toHaveBeenCalledOnce();

    await user.type(name, 'Stella App');
    expect(onLocalNameChange).toHaveBeenCalled();
  });

  it('announces an invalid path next to the active field', () => {
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath="invalid"
        remoteName=""
        localName=""
        error="Enter an absolute local path."
        busy={false}
        onSourceChange={() => undefined}
        onUrlChange={() => undefined}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onRemoteNameChange={() => undefined}
        onLocalNameChange={() => undefined}
        onChoosePath={() => undefined}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute local path.');
    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
