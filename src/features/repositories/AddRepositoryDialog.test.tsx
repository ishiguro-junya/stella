import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddRepositoryDialog } from './AddRepositoryDialog';

describe('AddRepositoryDialog', () => {
  it('shows URL and destination fields without source tabs in the Clone dialog', async () => {
    const user = userEvent.setup();
    const onChoosePath = vi.fn<() => void>();
    const onUrlChange = vi.fn<(url: string) => void>();
    render(
      <AddRepositoryDialog
        source="url"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath=""
        name=""
        busy={false}
        onUrlChange={onUrlChange}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onNameChange={() => undefined}
        onChoosePath={onChoosePath}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Clone Repository' });
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
    const url = within(dialog).getByRole('textbox', { name: 'Repository URL' });
    expect(url).not.toHaveAttribute('placeholder');
    const path = within(dialog).getByRole('textbox', { name: 'Repository path' });
    expect(path).toHaveValue('/Users/example/Documents');
    expect(within(dialog).getByRole('button', { name: 'Clone Repository' })).toHaveTextContent(
      'Clone',
    );
    const picker = within(dialog).getByRole('button', { name: 'Choose Repository' });
    expect(path.parentElement).toContainElement(picker);
    await user.click(picker);
    expect(onChoosePath).toHaveBeenCalledOnce();
    await user.type(url, 'https://example.com/stella.git');
    expect(onUrlChange).toHaveBeenCalled();
  });

  it('shows the icon-only path picker and a separate repository name field', async () => {
    const user = userEvent.setup();
    const onChoosePath = vi.fn<() => void>();
    const onNameChange = vi.fn<(name: string) => void>();
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath="/Users/example/stella"
        name=""
        busy={false}
        onUrlChange={() => undefined}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onNameChange={onNameChange}
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
    expect(onNameChange).toHaveBeenCalled();
  });

  it('announces an invalid path next to the active field', () => {
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        cloneParentPath="/Users/example/Documents"
        localPath="invalid"
        name=""
        error="Enter an absolute local path."
        busy={false}
        onUrlChange={() => undefined}
        onCloneParentPathChange={() => undefined}
        onLocalPathChange={() => undefined}
        onNameChange={() => undefined}
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
