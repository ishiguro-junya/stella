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

    expect(readPreferences().appearance).toBe('system');
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
        changes: { left: 312, right: 408 },
        history: { left: 288 },
        activity: { left: 584 },
      },
    });

    expect(readPreferences().paneWidths).toEqual({
      changes: { left: 312, right: 408 },
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
});
