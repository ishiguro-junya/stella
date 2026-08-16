import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { GitFlowRequest } from '../../domain/workspace';
import { GitFlowSheet } from './GitFlowSheet';

const OVERVIEW = {
  initialized: true,
  available: true,
  raw: {
    health: 'healthy',
    baseBranch: 'develop',
    topicType: 'feature',
    activeBranch: 'feature/search',
  },
  output: '',
  repoGeneration: 4,
} as const;

describe('GitFlowSheet', () => {
  it('reserves the overview and uses the shared loading icon without loading copy', () => {
    render(
      <GitFlowSheet
        loading
        onDismiss={() => undefined}
        onRun={() => undefined}
        onReload={() => undefined}
      />,
    );

    const overview = screen.getByRole('region', { name: 'Repository overview' });
    expect(overview).toHaveAttribute('aria-busy', 'true');
    expect(overview).not.toHaveTextContent('Loading…');
    expect(within(overview).getByRole('status', { name: 'Loading…' })).toHaveClass(
      'git-flow-overview-loading',
    );
  });

  it('shows overview fields and exposes every typed command family', () => {
    render(
      <GitFlowSheet
        overview={OVERVIEW}
        onDismiss={() => undefined}
        onRun={() => undefined}
        onReload={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Git Flow' });
    expect(dialog).toHaveTextContent('healthy');
    expect(dialog).toHaveTextContent('develop');
    expect(dialog).toHaveTextContent('feature/search');
    expect(within(dialog).getByLabelText('Command')).toHaveFocus();
    expect(within(dialog).getAllByRole('option')).toHaveLength(28);
  });

  it('shows a loading icon while running', () => {
    render(
      <GitFlowSheet
        busy
        overview={OVERVIEW}
        onDismiss={() => undefined}
        onRun={() => undefined}
        onReload={() => undefined}
      />,
    );

    const run = screen.getByRole('button', { name: 'Run' });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('aria-busy', 'true');
    expect(run.firstElementChild).toHaveClass('button-loading-icon', 'delayed-loading-icon');
  });

  it('builds a safe finish request and disables signing without GPG', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<(request: GitFlowRequest) => void>();
    render(
      <GitFlowSheet
        overview={OVERVIEW}
        onDismiss={() => undefined}
        onRun={onRun}
        onReload={() => undefined}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Command'), 'finish');
    await user.clear(screen.getByLabelText('Topic type'));
    await user.type(screen.getByLabelText('Topic type'), 'feature');
    await user.type(screen.getByLabelText('Name'), 'search');
    await user.type(screen.getByLabelText('Tag name (optional)'), 'v1.2.3');
    await user.click(screen.getByRole('checkbox', { name: 'Push after finishing' }));
    expect(screen.getByRole('checkbox', { name: 'Sign the tag' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'finish',
        topicType: 'feature',
        name: 'search',
        tagName: 'v1.2.3',
        push: true,
        sign: false,
      }),
    );
  });

  it('builds a custom topic configuration with separate update strategy', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn<(request: GitFlowRequest) => void>();
    render(
      <GitFlowSheet
        overview={OVERVIEW}
        onDismiss={() => undefined}
        onRun={onRun}
        onReload={() => undefined}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Command'), 'configAddTopic');
    await user.type(screen.getByLabelText('Name'), 'experiment');
    await user.type(screen.getByLabelText('Parent'), 'develop');
    await user.type(screen.getByLabelText('Prefix'), 'exp/');
    await user.selectOptions(screen.getByLabelText('Update strategy'), 'rebase');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'configAddTopic',
        name: 'experiment',
        parent: 'develop',
        prefix: 'exp/',
        downstreamStrategy: 'rebase',
      }),
    );
  });
});
