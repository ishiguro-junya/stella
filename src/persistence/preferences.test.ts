import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  readPreferences,
  rememberRepositoryPath,
  writePreferences,
} from './preferences';

describe('appearance preferences', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults legacy preferences without appearance to System', () => {
    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({
        version: 1,
        recentRepoPaths: [],
        openRepoPaths: [],
        view: 'changes',
        paneWidths: { left: 244, right: 336 },
        commitDrafts: {},
      }),
    );

    expect(readPreferences()).toMatchObject({
      appearance: 'system',
      diffStyle: 'unified',
      splitStageView: false,
      useConventionalCommits: false,
      stickyFileHeaders: false,
      editorLineWrapping: false,
      editorWrapColumn: 120,
    });
  });

  it('fills a missing v1 language from macOS and defaults the screen-specific pane widths', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({
        version: 1,
        appearance: 'dark',
        recentRepoPaths: ['/tmp/stella'],
        openRepoPaths: ['/tmp/stella'],
        selectedRepoPath: '/tmp/stella',
        view: 'history',
        paneWidths: { left: 300, right: 400 },
        commitDrafts: {},
      }),
    );

    expect(readPreferences()).toMatchObject({
      language: 'ja',
      appearance: 'dark',
      registeredRepoPaths: ['/tmp/stella'],
      repositoryNames: {},
      openRepoPaths: ['/tmp/stella'],
      selectedRepoPath: '/tmp/stella',
      view: 'history',
      paneWidths: DEFAULT_PREFERENCES.paneWidths,
    });
  });

  it('round-trips independent pane widths for Changes, History, and Activity', () => {
    writePreferences({
      ...DEFAULT_PREFERENCES,
      paneWidths: {
        changes: { left: 344, right: 408 },
        history: { left: 288 },
        activity: { left: 584 },
      },
    });

    expect(readPreferences().paneWidths).toEqual({
      changes: { left: 344, right: 408 },
      history: { left: 288 },
      activity: { left: 584 },
    });
  });

  it('keeps a saved language ahead of the current macOS language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    writePreferences({ ...DEFAULT_PREFERENCES, language: 'en' });
    expect(readPreferences().language).toBe('en');
  });

  it('round-trips a fixed appearance', () => {
    writePreferences({ ...DEFAULT_PREFERENCES, appearance: 'dark' });
    expect(readPreferences().appearance).toBe('dark');
  });

  it('defaults Stage display to Hide and round-trips the Show preference', () => {
    expect(DEFAULT_PREFERENCES.splitStageView).toBe(false);
    writePreferences({ ...DEFAULT_PREFERENCES, splitStageView: true });
    expect(readPreferences().splitStageView).toBe(true);
  });

  it('defaults Conventional Commits to off and round-trips the enabled preference', () => {
    expect(DEFAULT_PREFERENCES.useConventionalCommits).toBe(false);
    writePreferences({ ...DEFAULT_PREFERENCES, useConventionalCommits: true });
    expect(readPreferences().useConventionalCommits).toBe(true);
  });

  it('migrates existing structured Commit drafts to the Conventional format', () => {
    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        useConventionalCommits: undefined,
        commitDrafts: {
          repo: {
            type: 'fix',
            scope: 'ui',
            breaking: false,
            description: 'keep the draft',
          },
        },
      }),
    );

    expect(readPreferences()).toMatchObject({
      useConventionalCommits: false,
      commitDrafts: {
        repo: {
          plainMessage: '',
          conventional: {
            type: 'fix',
            scope: 'ui',
            breaking: false,
            description: 'keep the draft',
          },
        },
      },
    });
  });

  it('defaults file header following to off and round-trips an enabled preference', () => {
    expect(DEFAULT_PREFERENCES.stickyFileHeaders).toBe(false);
    writePreferences({ ...DEFAULT_PREFERENCES, stickyFileHeaders: true });
    expect(readPreferences().stickyFileHeaders).toBe(true);
  });

  it('defaults editor wrapping to off with 120 characters and bounds saved lengths', () => {
    expect(DEFAULT_PREFERENCES.editorLineWrapping).toBe(false);
    expect(DEFAULT_PREFERENCES.editorWrapColumn).toBe(120);
    writePreferences({
      ...DEFAULT_PREFERENCES,
      editorLineWrapping: true,
      editorWrapColumn: 96,
    });
    expect(readPreferences()).toMatchObject({
      editorLineWrapping: true,
      editorWrapColumn: 96,
    });

    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({ ...DEFAULT_PREFERENCES, editorWrapColumn: 999 }),
    );
    expect(readPreferences().editorWrapColumn).toBe(400);
  });

  it('round-trips the selected Diff layout', () => {
    writePreferences({ ...DEFAULT_PREFERENCES, diffStyle: 'split' });
    expect(readPreferences().diffStyle).toBe('split');
  });

  it('migrates the existing recent repository list without classifying its entries', () => {
    localStorage.setItem(
      'stella.preferences.v1',
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        registeredRepoPaths: undefined,
        recentRepoPaths: ['/tmp/remote-clone', '/tmp/local', '/tmp/remote-clone'],
      }),
    );

    expect(readPreferences().registeredRepoPaths).toEqual(['/tmp/remote-clone', '/tmp/local']);
  });

  it('moves a reopened repository to the front and does not duplicate it', () => {
    writePreferences({
      ...DEFAULT_PREFERENCES,
      registeredRepoPaths: ['/tmp/first', '/tmp/second'],
    });

    expect(rememberRepositoryPath('/tmp/second').registeredRepoPaths).toEqual([
      '/tmp/second',
      '/tmp/first',
    ]);
  });

  it('stores a custom repository name without replacing it on an ordinary reopen', () => {
    writePreferences(DEFAULT_PREFERENCES);

    expect(rememberRepositoryPath('/tmp/stella', 'My Stella').repositoryNames).toEqual({
      '/tmp/stella': 'My Stella',
    });
    expect(rememberRepositoryPath('/tmp/stella').repositoryNames).toEqual({
      '/tmp/stella': 'My Stella',
    });
  });
});
