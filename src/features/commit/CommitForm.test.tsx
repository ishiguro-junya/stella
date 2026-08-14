import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCES, writePreferences } from '../../persistence/preferences';
import { markWorkspaceErrorHandled } from '../../ui/WorkspaceErrorDialog';
import { CommitForm } from './CommitForm';

describe('CommitForm validation', () => {
  it('renders compact actions in the Commit toolbar without submitting the form', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    const onSync = vi.fn<() => void>();
    render(
      <CommitForm
        headerActions={
          <button type="button" aria-label="Sync" onClick={onSync}>
            S
          </button>
        }
        onCommit={onCommit}
      />,
    );

    const sync = screen.getByRole('button', { name: 'Sync' });
    const toolbar = screen.getByRole('heading', { name: 'Commit' }).closest('.pane-toolbar');
    expect(toolbar).toContainElement(sync);
    await user.click(sync);
    expect(onSync).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('can use an external heading while keeping header actions available', () => {
    render(
      <section aria-labelledby="external-commit-heading">
        <h2 id="external-commit-heading">Commit</h2>
        <CommitForm
          showHeading={false}
          labelledBy="external-commit-heading"
          headerActions={<button type="button">Sync</button>}
          onCommit={vi.fn<() => Promise<void>>(async () => undefined)}
        />
      </section>,
    );

    expect(screen.getAllByRole('heading', { name: 'Commit' })).toHaveLength(1);
    const form = screen.getByRole('form', { name: 'Commit' });
    expect(form).toContainElement(screen.getByRole('button', { name: 'Sync' }));
    expect(form.querySelector('.pane-toolbar')).toHaveClass('actions-only');
  });

  it('reveals and focuses the first invalid field when Commit is submitted', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    const onAttentionRequired = vi.fn<() => void>();
    render(<CommitForm onAttentionRequired={onAttentionRequired} onCommit={onCommit} />);
    const description = screen.getByLabelText('Message');
    const commit = screen.getByRole('button', { name: 'Commit' });

    expect(commit).toBeEnabled();
    expect(description).not.toHaveAttribute('placeholder');
    expect(description).toHaveAttribute('aria-invalid', 'false');

    await user.click(commit);

    const error = screen.getByText('Enter a message.');
    expect(description).toHaveFocus();
    expect(description).toHaveAttribute('aria-invalid', 'true');
    expect(description).toHaveAttribute('aria-describedby', error.id);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onAttentionRequired).toHaveBeenCalledOnce();
  });

  it('requests attention when Commit submission fails', async () => {
    const user = userEvent.setup();
    const onAttentionRequired = vi.fn<() => void>();
    render(
      <CommitForm
        onAttentionRequired={onAttentionRequired}
        onCommit={vi.fn<() => Promise<void>>(async () => {
          throw new Error('Hook rejected the commit.');
        })}
      />,
    );

    await user.type(screen.getByLabelText('Message'), 'handle a failed commit');
    await user.click(screen.getByRole('button', { name: 'Commit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Commit failed.');
    expect(onAttentionRequired).toHaveBeenCalledOnce();
  });

  it('forwards unhandled runtime failures to the shared dialog handler', async () => {
    const user = userEvent.setup();
    const failure = new Error('Hook rejected the commit.');
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    render(
      <CommitForm
        onError={onError}
        onCommit={vi.fn<() => Promise<void>>(async () => {
          throw failure;
        })}
      />,
    );

    await user.type(screen.getByLabelText('Message'), 'report a failed commit');
    await user.click(screen.getByRole('button', { name: 'Commit' }));

    expect(onError).toHaveBeenCalledWith('Commit failed', failure, 'Commit failed.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not report a failure twice when the workspace action already opened a dialog', async () => {
    const user = userEvent.setup();
    const onError = vi.fn<(title: string, cause: unknown, fallback: string) => void>();
    render(
      <CommitForm
        onError={onError}
        onCommit={vi.fn<() => Promise<void>>(async () => {
          throw markWorkspaceErrorHandled(new Error('Already reported.'), 'Commit failed.');
        })}
      />,
    );

    await user.type(screen.getByLabelText('Message'), 'avoid duplicate dialogs');
    await user.click(screen.getByRole('button', { name: 'Commit' }));

    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports type and scope errors while their fields are edited', async () => {
    const user = userEvent.setup();
    render(
      <CommitForm
        useConventionalCommits
        onCommit={vi.fn<() => Promise<void>>(async () => undefined)}
      />,
    );
    const type = screen.getByRole('combobox', { name: 'Type' });
    const scope = screen.getByRole('textbox', { name: 'Scope' });
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();

    await user.clear(type);
    await user.type(type, 'Feat2');
    await user.type(scope, 'ui(dialog)');

    const typeError = screen.getByText('Type must contain lowercase letters only.');
    const scopeError = screen.getByText('Scope cannot contain parentheses or line breaks.');
    expect(type).toHaveAttribute('aria-invalid', 'true');
    expect(type).toHaveAttribute('aria-describedby', typeError.id);
    expect(scope).toHaveAttribute('aria-invalid', 'true');
    expect(scope).toHaveAttribute('aria-describedby', scopeError.id);
    expect(document.querySelectorAll('.commit-field-error')).toHaveLength(3);
  });

  it('omits legacy Body and Footer values restored from a draft', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    writePreferences({
      ...DEFAULT_PREFERENCES,
      commitDrafts: {
        repo: {
          plainMessage: '',
          conventional: {
            type: 'feat',
            scope: '',
            breaking: false,
            description: 'restore draft',
            body: 'first line\r\nsecond line',
            footer: 'Refs: #123',
          },
        },
      },
    });
    render(<CommitForm useConventionalCommits draftKey="repo" onCommit={onCommit} />);

    expect(screen.queryByText('Ready to commit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Body')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Footer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Commit message preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Commit' }));

    expect(onCommit).toHaveBeenCalledWith({
      format: 'conventional',
      type: 'feat',
      breaking: false,
      description: 'restore draft',
    });
  });

  it('shows only Message by default and submits a plain one-line message', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    render(<CommitForm onCommit={onCommit} />);

    const message = screen.getByRole('textbox', { name: 'Message' });
    expect(message).not.toHaveAttribute('placeholder');
    expect(screen.queryByRole('combobox', { name: 'Type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Scope' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Breaking Change' })).not.toBeInTheDocument();

    await user.type(message, '  ordinary commit message  ');
    await user.click(screen.getByRole('button', { name: 'Commit' }));
    expect(onCommit).toHaveBeenCalledWith({
      format: 'plain',
      message: 'ordinary commit message',
    });
  });

  it('keeps plain and Conventional drafts separate for the same repository', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    const { rerender } = render(<CommitForm draftKey="repo" onCommit={onCommit} />);

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'plain draft');
    rerender(<CommitForm useConventionalCommits draftKey="repo" onCommit={onCommit} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'conventional draft');

    rerender(<CommitForm draftKey="repo" onCommit={onCommit} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('plain draft');
    rerender(<CommitForm useConventionalCommits draftKey="repo" onCommit={onCommit} />);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('conventional draft');
  });

  it('shows and exposes a disabled reason', () => {
    render(
      <CommitForm
        disabled
        disabledReason="Stage changes before committing."
        onCommit={vi.fn<() => Promise<void>>(async () => undefined)}
      />,
    );

    const commit = screen.getByRole('button', { name: 'Commit' });
    expect(commit).toBeDisabled();
    expect(commit).toHaveAccessibleDescription('Stage changes before committing.');
    expect(screen.getByText('Stage changes before committing.')).toBeVisible();
  });

  it('renders Cancel without submitting and reports successful completion', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn<() => void>();
    const onCommitted = vi.fn<() => void>();
    const onCommit = vi.fn<() => Promise<void>>(async () => undefined);
    render(<CommitForm onCancel={onCancel} onCommitted={onCommitted} onCommit={onCommit} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Message'), 'finish dialog commit');
    await user.click(screen.getByRole('button', { name: 'Commit' }));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledOnce();
  });
});
