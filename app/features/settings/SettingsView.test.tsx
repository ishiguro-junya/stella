import { fireEvent, render, screen, within } from '@testing-library/react';
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
      onImagePreviewLayoutChange: vi.fn<SettingsViewProps['onImagePreviewLayoutChange']>(),
      onSplitStageViewChange: vi.fn<SettingsViewProps['onSplitStageViewChange']>(),
      onDiffFileListDisplayChange: vi.fn<SettingsViewProps['onDiffFileListDisplayChange']>(),
      onUseConventionalCommitsChange: vi.fn<SettingsViewProps['onUseConventionalCommitsChange']>(),
      onStickyFileHeadersChange: vi.fn<SettingsViewProps['onStickyFileHeadersChange']>(),
      onEditorLineWrappingChange: vi.fn<SettingsViewProps['onEditorLineWrappingChange']>(),
      onEditorWrapColumnChange: vi.fn<SettingsViewProps['onEditorWrapColumnChange']>(),
      onResetPaneWidths: vi.fn<SettingsViewProps['onResetPaneWidths']>(),
      onRepositoryBasePathChange: vi.fn<SettingsViewProps['onRepositoryBasePathChange']>(),
      onChooseRepositoryBasePath: vi.fn<SettingsViewProps['onChooseRepositoryBasePath']>(),
      onOpenFilesAndFoldersSettings: vi.fn<SettingsViewProps['onOpenFilesAndFoldersSettings']>(),
      onIgnorePatternsChange: vi.fn<SettingsViewProps['onIgnorePatternsChange']>(),
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
      imagePreviewLayout: 'split',
      splitStageView: true,
      diffFileListDisplay: 'nameAndPath',
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
        ignorePatterns: '.DS_Store\n._*\nThumbs.db\n[Dd]esktop.ini',
      },
      ...handlers,
    };
    const { rerender } = render(<SettingsView {...settingsProps} />);
    const generalButton = screen.getByRole('button', { name: 'General' });
    const permissionsButton = screen.getByRole('button', { name: 'Permissions' });
    const appearanceButton = screen.getByRole('button', { name: 'Appearance' });
    const diffButton = screen.getByRole('button', { name: 'Diff' });
    const editorButton = screen.getByRole('button', { name: 'Editor' });
    const gitButton = screen.getByRole('button', { name: 'Git' });

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    const categoryNavigation = screen.getByRole('navigation', { name: 'Settings categories' });
    expect(categoryNavigation).toBeVisible();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(generalButton).toHaveFocus();
    expect(generalButton).toHaveAttribute('aria-current', 'page');
    for (const button of [
      permissionsButton,
      appearanceButton,
      diffButton,
      editorButton,
      gitButton,
    ]) {
      expect(button).not.toHaveAttribute('aria-current');
    }
    expect(diffButton).toHaveAttribute('data-settings-category', 'diff');
    expect(diffButton).toHaveAttribute('aria-controls', 'settings-category-diff');
    expect(diffButton.querySelector('.lucide-file-diff')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(permissionsButton).toHaveFocus();
    expect(permissionsButton).toHaveAttribute('aria-current', 'page');
    expect(categoryNavigation).toHaveClass('is-keyboard-navigating');
    fireEvent.pointerMove(categoryNavigation);
    expect(categoryNavigation).not.toHaveClass('is-keyboard-navigating');
    await user.keyboard('{ArrowUp}');
    expect(generalButton).toHaveFocus();
    expect(generalButton).toHaveAttribute('aria-current', 'page');
    expect(categoryNavigation).toHaveClass('is-keyboard-navigating');

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

    fireEvent.click(permissionsButton);
    expect(permissionsButton).toHaveFocus();
    fireEvent.keyDown(permissionsButton, { key: 'ArrowDown' });
    expect(appearanceButton).toHaveFocus();
    expect(appearanceButton).toHaveAttribute('aria-current', 'page');
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
    ).toEqual(['Appearance', 'Font Size', 'Interface Font', 'Code Font', 'Split Pane Positions']);
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
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(handlers.onResetPaneWidths).toHaveBeenCalledOnce();

    await user.click(diffButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Stage Display', 'File Display Format', 'Conventional Commits']);
    const stageDisplaySelect = screen.getByRole('combobox', { name: 'Stage Display' });
    const diffFileListDisplaySelect = screen.getByRole('combobox', {
      name: 'File Display Format',
    });
    expect(
      within(stageDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Show', 'Hide']);
    expect(
      within(diffFileListDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['File Name and Path', 'Full Path', 'Tree']);
    await user.selectOptions(stageDisplaySelect, 'hide');
    await user.selectOptions(diffFileListDisplaySelect, 'tree');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Conventional Commits' }),
      'enabled',
    );
    expect(handlers.onSplitStageViewChange).toHaveBeenCalledWith(false);
    expect(handlers.onDiffFileListDisplayChange).toHaveBeenCalledWith('tree');
    expect(handlers.onUseConventionalCommitsChange).toHaveBeenCalledWith(true);

    await user.click(editorButton);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Diff layout',
      'Image Preview Layout',
      'Sticky File Headers',
      'Line Wrapping',
      'Wrap Length',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Diff layout' }), 'split');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Image Preview Layout' }),
      'unified',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sticky File Headers' }),
      'enabled',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line Wrapping' }), 'enabled');
    expect(handlers.onDiffStyleChange).toHaveBeenCalledWith('split');
    expect(handlers.onImagePreviewLayoutChange).toHaveBeenCalledWith('unified');
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
    ).toEqual(['Global Ignore List', 'Git Toolchain']);
    const ignorePatterns = screen.getByRole('textbox', { name: 'Global Ignore List' });
    expect(ignorePatterns).toHaveValue('.DS_Store\n._*\nThumbs.db\n[Dd]esktop.ini');
    await user.click(ignorePatterns);
    await user.tab();
    expect(handlers.onIgnorePatternsChange).not.toHaveBeenCalled();
    await user.clear(ignorePatterns);
    await user.type(ignorePatterns, '# custom\n*.tmp\n!important.tmp');
    await user.tab();
    expect(handlers.onIgnorePatternsChange).toHaveBeenCalledWith('# custom\n*.tmp\n!important.tmp');
    expect(ignorePatterns).toHaveValue('# custom\n*.tmp\n!important.tmp');
    rerender(<SettingsView {...settingsProps} toolchainBusy />);
    expect(screen.getByRole('textbox', { name: 'Global Ignore List' })).toBeDisabled();
    rerender(<SettingsView {...settingsProps} />);
    expect(screen.getByRole('textbox', { name: 'Global Ignore List' })).toHaveValue(
      '# custom\n*.tmp\n!important.tmp',
    );
    rerender(
      <SettingsView
        {...settingsProps}
        toolchainStatus={{
          ...settingsProps.toolchainStatus!,
          ignorePatterns: '# custom\n*.tmp\n!important.tmp',
        }}
      />,
    );
    const savedIgnorePatterns = screen.getByRole('textbox', { name: 'Global Ignore List' });
    await user.clear(savedIgnorePatterns);
    await user.tab();
    expect(handlers.onIgnorePatternsChange).toHaveBeenLastCalledWith('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Git Toolchain' }), 'system');
    expect(handlers.onToolchainModeChange).toHaveBeenCalledWith('system');
    expect(screen.getByText('In use')).toBeVisible();
    expect(screen.getByText('Next launch')).toBeVisible();
    const gitPath = screen.getByText('/app/git', { selector: 'code' });
    expect(gitPath).toHaveAttribute('tabindex', '0');
    fireEvent.focus(gitPath);
    expect(screen.getByRole('tooltip')).toHaveTextContent('/app/git');

    const loadingSettingsProps = { ...settingsProps };
    delete loadingSettingsProps.toolchainStatus;
    rerender(<SettingsView {...loadingSettingsProps} />);
    expect(screen.getByRole('region', { name: 'Global Ignore List' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Global Ignore List' })).toBeDisabled();
    const toolchain = screen.getByRole('region', { name: 'Git Toolchain' });
    expect(toolchain).toHaveAttribute('aria-busy', 'true');
    expect(within(toolchain).getByRole('status', { name: 'Loading…' })).toHaveClass(
      'settings-toolchain-loading',
    );
  });
});
