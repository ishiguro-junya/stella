import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView, type SettingsViewProps } from './SettingsView';

describe('SettingsView', () => {
  it('switches between all setting categories without changing setting behavior', async () => {
    const user = userEvent.setup();
    const handlers = {
      onAppearanceChange: vi.fn<SettingsViewProps['onAppearanceChange']>(),
      onLanguageChange: vi.fn<SettingsViewProps['onLanguageChange']>(),
      onFontSizeChange: vi.fn<SettingsViewProps['onFontSizeChange']>(),
      onUiFontChange: vi.fn<SettingsViewProps['onUiFontChange']>(),
      onCodeFontChange: vi.fn<SettingsViewProps['onCodeFontChange']>(),
      onAutomaticUpdateChecksChange: vi.fn<SettingsViewProps['onAutomaticUpdateChecksChange']>(),
      onDiffStyleChange: vi.fn<SettingsViewProps['onDiffStyleChange']>(),
      onSplitStageViewChange: vi.fn<SettingsViewProps['onSplitStageViewChange']>(),
      onChangeListDisplayChange: vi.fn<SettingsViewProps['onChangeListDisplayChange']>(),
      onUseConventionalCommitsChange: vi.fn<SettingsViewProps['onUseConventionalCommitsChange']>(),
      onStickyFileHeadersChange: vi.fn<SettingsViewProps['onStickyFileHeadersChange']>(),
      onEditorLineWrappingChange: vi.fn<SettingsViewProps['onEditorLineWrappingChange']>(),
      onEditorWrapColumnChange: vi.fn<SettingsViewProps['onEditorWrapColumnChange']>(),
      onRepositoryBasePathChange: vi.fn<SettingsViewProps['onRepositoryBasePathChange']>(),
      onChooseRepositoryBasePath: vi.fn<SettingsViewProps['onChooseRepositoryBasePath']>(),
      onOpenFilesAndFoldersSettings: vi.fn<SettingsViewProps['onOpenFilesAndFoldersSettings']>(),
      onToolchainModeChange: vi.fn<SettingsViewProps['onToolchainModeChange']>(),
    };
    const settingsProps: ComponentProps<typeof SettingsView> = {
      appearance: 'system',
      language: 'en',
      fontSize: 100,
      uiFont: 'system',
      codeFont: 'sfMono',
      automaticUpdateChecks: true,
      diffStyle: 'unified',
      splitStageView: true,
      changeListDisplay: 'nameAndPath',
      useConventionalCommits: false,
      stickyFileHeaders: false,
      editorLineWrapping: false,
      editorWrapColumn: 120,
      repositoryBasePath: '/Users/example/Documents',
      repositoryAccessNeedsAttention: false,
      toolchainStatus: {
        activeMode: 'bundled',
        selectedMode: 'bundled',
        restartRequired: false,
        git: { available: true, path: '/app/git', version: 'git version 2.55.0', error: null },
        gitLfs: { available: true, path: '/app/git-lfs', version: 'git-lfs/3.7.1', error: null },
        gitFlow: { available: true, path: '/app/git-flow', version: '1.2.0', error: null },
        gpgAvailable: true,
      },
      ...handlers,
    };
    const { rerender } = render(<SettingsView {...settingsProps} />);
    const generalButton = screen.getByRole('button', { name: 'General' });
    const permissionsButton = screen.getByRole('button', { name: 'Permissions' });
    const appearanceButton = screen.getByRole('button', { name: 'Appearance' });
    const changesButton = screen.getByRole('button', { name: 'Changes' });
    const editorButton = screen.getByRole('button', { name: 'Editor' });
    const gitButton = screen.getByRole('button', { name: 'Git' });

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Settings categories' })).toBeVisible();
    expect(generalButton).toHaveAttribute('aria-current', 'page');
    for (const button of [
      permissionsButton,
      appearanceButton,
      changesButton,
      editorButton,
      gitButton,
    ]) {
      expect(button).not.toHaveAttribute('aria-current');
    }

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Language', 'Automatic Updates']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja');
    expect(handlers.onLanguageChange).toHaveBeenCalledWith('ja');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Automatic Updates' }),
      'disabled',
    );
    expect(handlers.onAutomaticUpdateChecksChange).toHaveBeenCalledWith(false);

    await user.click(permissionsButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Repository Location']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const repositoryBasePathInput = screen.getByRole('textbox', { name: 'Repository Location' });
    await user.clear(repositoryBasePathInput);
    await user.type(repositoryBasePathInput, 'relative/path');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute local path.');
    expect(handlers.onRepositoryBasePathChange).not.toHaveBeenCalled();
    await user.clear(repositoryBasePathInput);
    await user.type(repositoryBasePathInput, '/Users/example/Repositories');
    await user.tab();
    expect(handlers.onRepositoryBasePathChange).toHaveBeenCalledWith('/Users/example/Repositories');
    const chooseRepositoryBasePath = screen.getByRole('button', { name: 'Choose Location' });
    expect(repositoryBasePathInput.closest('.directory-input-control')).toContainElement(
      chooseRepositoryBasePath,
    );
    await user.click(chooseRepositoryBasePath);
    expect(handlers.onChooseRepositoryBasePath).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Check System Settings' }));
    expect(handlers.onOpenFilesAndFoldersSettings).toHaveBeenCalledOnce();
    rerender(<SettingsView {...settingsProps} repositoryAccessNeedsAttention />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'One or more registered repositories cannot be accessed.',
    );

    await user.click(appearanceButton);
    expect(appearanceButton).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Appearance', 'Font Size', 'Interface Font', 'Code Font']);
    const fontSizeSelect = screen.getByRole('combobox', { name: 'Font Size' });
    expect(
      within(fontSizeSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['80%', '90%', '100% (Default)', '110%', '120%']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Appearance' }), 'light');
    await user.selectOptions(fontSizeSelect, '120');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Interface Font' }),
      'avenirNext',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Code Font' }), 'menlo');
    expect(handlers.onAppearanceChange).toHaveBeenCalledWith('light');
    expect(handlers.onFontSizeChange).toHaveBeenCalledWith(120);
    expect(handlers.onUiFontChange).toHaveBeenCalledWith('avenirNext');
    expect(handlers.onCodeFontChange).toHaveBeenCalledWith('menlo');

    await user.click(changesButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Stage Display', 'File Display Format', 'Conventional Commits']);
    const stageDisplaySelect = screen.getByRole('combobox', { name: 'Stage Display' });
    const changeListDisplaySelect = screen.getByRole('combobox', {
      name: 'File Display Format',
    });
    expect(
      within(stageDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Show', 'Hide']);
    expect(
      within(changeListDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Full Path', 'Tree', 'File Name and Path']);
    await user.selectOptions(stageDisplaySelect, 'hide');
    await user.selectOptions(changeListDisplaySelect, 'tree');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Conventional Commits' }),
      'enabled',
    );
    expect(handlers.onSplitStageViewChange).toHaveBeenCalledWith(false);
    expect(handlers.onChangeListDisplayChange).toHaveBeenCalledWith('tree');
    expect(handlers.onUseConventionalCommitsChange).toHaveBeenCalledWith(true);

    await user.click(editorButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Diff layout', 'Sticky File Headers', 'Line Wrapping', 'Wrap Length']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Diff layout' }), 'split');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sticky File Headers' }),
      'enabled',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line Wrapping' }), 'enabled');
    expect(handlers.onDiffStyleChange).toHaveBeenCalledWith('split');
    expect(handlers.onStickyFileHeadersChange).toHaveBeenCalledWith(true);
    expect(handlers.onEditorLineWrappingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('spinbutton', { name: 'Wrap Length' })).toBeDisabled();
    rerender(<SettingsView {...settingsProps} editorLineWrapping />);
    const wrapColumnInput = screen.getByRole('spinbutton', { name: 'Wrap Length' });
    expect(wrapColumnInput).toBeEnabled();
    await user.clear(wrapColumnInput);
    await user.type(wrapColumnInput, '100');
    expect(handlers.onEditorWrapColumnChange).toHaveBeenLastCalledWith(100);

    await user.click(gitButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Git Toolchain']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Git Toolchain' }), 'system');
    expect(handlers.onToolchainModeChange).toHaveBeenCalledWith('system');
    expect(screen.getByText('Current session')).toBeVisible();
    expect(screen.getByText('Next launch')).toBeVisible();

    const loadingSettingsProps = { ...settingsProps };
    delete loadingSettingsProps.toolchainStatus;
    rerender(<SettingsView {...loadingSettingsProps} />);
    const toolchain = screen.getByRole('region', { name: 'Git Toolchain' });
    expect(toolchain).toHaveAttribute('aria-busy', 'true');
    expect(toolchain.querySelectorAll('.settings-toolchain-modes > div')).toHaveLength(2);
    expect(toolchain.querySelectorAll('.settings-toolchain-components > div')).toHaveLength(3);
  });
});
