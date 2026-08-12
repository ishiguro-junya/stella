import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddRepositoryDialog } from './AddRepositoryDialog';

describe('AddRepositoryDialog', () => {
  it('defaults to URL and switches to a path field with an adjacent picker button', async () => {
    const user = userEvent.setup();
    const onChooseLocal = vi.fn<() => void>();
    const onSourceChange = vi.fn<(source: 'url' | 'path') => void>();
    const onUrlChange = vi.fn<(url: string) => void>();
    render(
      <AddRepositoryDialog
        source="url"
        url=""
        path=""
        name=""
        busy={false}
        onSourceChange={onSourceChange}
        onUrlChange={onUrlChange}
        onPathChange={() => undefined}
        onNameChange={() => undefined}
        onChooseLocal={onChooseLocal}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Add Repository' });
    expect(within(dialog).getByRole('tab', { name: 'URL' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const url = within(dialog).getByRole('textbox', { name: 'Repository URL' });
    expect(url).not.toHaveAttribute('placeholder');
    await user.type(url, 'https://example.com/stella.git');
    expect(onUrlChange).toHaveBeenCalled();

    await user.click(within(dialog).getByRole('tab', { name: 'Path' }));
    expect(onSourceChange).toHaveBeenCalledWith('path');
  });

  it('shows the icon-only path picker and a separate repository name field', async () => {
    const user = userEvent.setup();
    const onChooseLocal = vi.fn<() => void>();
    const onNameChange = vi.fn<(name: string) => void>();
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        path="/Users/example/stella"
        name=""
        busy={false}
        onSourceChange={() => undefined}
        onUrlChange={() => undefined}
        onPathChange={() => undefined}
        onNameChange={onNameChange}
        onChooseLocal={onChooseLocal}
        onDismiss={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Add Repository' });
    const path = within(dialog).getByRole('textbox', { name: 'Repository path' });
    const name = within(dialog).getByRole('textbox', { name: 'Repository name' });
    expect(path).not.toHaveAttribute('placeholder');
    expect(name).not.toHaveAttribute('placeholder');
    const picker = within(dialog).getByRole('button', { name: 'Choose Repository' });
    expect(path.parentElement).toContainElement(picker);
    expect(picker).not.toHaveTextContent(/Finder|Choose/u);
    await user.click(picker);
    expect(onChooseLocal).toHaveBeenCalledOnce();

    await user.type(name, 'Stella App');
    expect(onNameChange).toHaveBeenCalled();
  });

  it('announces an invalid path next to the active field', () => {
    render(
      <AddRepositoryDialog
        source="path"
        url=""
        path="invalid"
        name=""
        error="Enter an absolute local path."
        busy={false}
        onSourceChange={() => undefined}
        onUrlChange={() => undefined}
        onPathChange={() => undefined}
        onNameChange={() => undefined}
        onChooseLocal={() => undefined}
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
