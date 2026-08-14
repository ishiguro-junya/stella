import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from './SettingsView';

describe('SettingsView', () => {
  it('exposes editor wrapping and the existing settings controls', async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn<(appearance: 'system' | 'light' | 'dark') => void>();
    const onLanguageChange = vi.fn<(language: 'ja' | 'en') => void>();
    const onFontSizeChange = vi.fn<(fontSize: 80 | 90 | 100 | 110 | 120) => void>();
    const onUiFontChange =
      vi.fn<(font: 'system' | 'hiraginoSans' | 'helveticaNeue' | 'avenirNext') => void>();
    const onCodeFontChange = vi.fn<(font: 'sfMono' | 'menlo' | 'monaco') => void>();
    const onAutomaticUpdateChecksChange = vi.fn<(enabled: boolean) => void>();
    const onDiffStyleChange = vi.fn<(style: 'unified' | 'split') => void>();
    const onSplitStageViewChange = vi.fn<(split: boolean) => void>();
    const onChangeListDisplayChange =
      vi.fn<(display: 'nameAndPath' | 'fullPath' | 'tree') => void>();
    const onUseConventionalCommitsChange = vi.fn<(enabled: boolean) => void>();
    const onStickyFileHeadersChange = vi.fn<(sticky: boolean) => void>();
    const onEditorLineWrappingChange = vi.fn<(enabled: boolean) => void>();
    const onEditorWrapColumnChange = vi.fn<(column: number) => void>();
    const onRepositoryBasePathChange = vi.fn<(path: string) => void>();
    const onToolchainModeChange = vi.fn<(mode: 'bundled' | 'system') => void>();
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
      toolchainStatus: {
        activeMode: 'bundled',
        selectedMode: 'bundled',
        restartRequired: false,
        git: { available: true, path: '/app/git', version: 'git version 2.55.0', error: null },
        gitLfs: { available: true, path: '/app/git-lfs', version: 'git-lfs/3.7.1', error: null },
        gitFlow: { available: true, path: '/app/git-flow', version: '1.2.0', error: null },
        gpgAvailable: true,
      },
      onAppearanceChange,
      onLanguageChange,
      onFontSizeChange,
      onUiFontChange,
      onCodeFontChange,
      onAutomaticUpdateChecksChange,
      onDiffStyleChange,
      onSplitStageViewChange,
      onChangeListDisplayChange,
      onUseConventionalCommitsChange,
      onStickyFileHeadersChange,
      onEditorLineWrappingChange,
      onEditorWrapColumnChange,
      onRepositoryBasePathChange,
      onToolchainModeChange,
    };
    const { rerender } = render(<SettingsView {...settingsProps} />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('sr-only');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Language',
      'Appearance',
      'Font Size',
      'Interface Font',
      'Code Font',
      'Automatic Updates',
      'Repository Location',
      'Diff layout',
      'Stage Display',
      'File Display Format',
      'Conventional Commits',
      'Sticky File Headers',
      'Line Wrapping',
      'Wrap Length',
      'Git Toolchain',
    ]);
    const languageSelect = screen.getByRole('combobox', { name: 'Language' });
    const appearanceSelect = screen.getByRole('combobox', { name: 'Appearance' });
    const fontSizeSelect = screen.getByRole('combobox', { name: 'Font Size' });
    const uiFontSelect = screen.getByRole('combobox', { name: 'Interface Font' });
    const codeFontSelect = screen.getByRole('combobox', { name: 'Code Font' });
    const automaticUpdateChecksSelect = screen.getByRole('combobox', {
      name: 'Automatic Updates',
    });
    const diffLayoutSelect = screen.getByRole('combobox', { name: 'Diff layout' });
    const stageDisplaySelect = screen.getByRole('combobox', { name: 'Stage Display' });
    const changeListDisplaySelect = screen.getByRole('combobox', {
      name: 'File Display Format',
    });
    const conventionalCommitsSelect = screen.getByRole('combobox', {
      name: 'Conventional Commits',
    });
    const stickyFileHeadersSelect = screen.getByRole('combobox', {
      name: 'Sticky File Headers',
    });
    const editorLineWrappingSelect = screen.getByRole('combobox', {
      name: 'Line Wrapping',
    });
    const editorWrapColumnInput = screen.getByRole('spinbutton', { name: 'Wrap Length' });
    const repositoryBasePathInput = screen.getByRole('textbox', {
      name: 'Repository Location',
    });
    const toolchainSelect = screen.getByRole('combobox', { name: 'Git Toolchain' });
    expect(screen.getAllByRole('combobox')).toHaveLength(13);
    expect(languageSelect).toHaveValue('en');
    expect(appearanceSelect).toHaveValue('system');
    expect(fontSizeSelect).toHaveValue('100');
    expect(uiFontSelect).toHaveValue('system');
    expect(codeFontSelect).toHaveValue('sfMono');
    expect(automaticUpdateChecksSelect).toHaveValue('enabled');
    expect(diffLayoutSelect).toHaveValue('unified');
    expect(stageDisplaySelect).toHaveValue('show');
    expect(changeListDisplaySelect).toHaveValue('nameAndPath');
    expect(conventionalCommitsSelect).toHaveValue('disabled');
    expect(stickyFileHeadersSelect).toHaveValue('disabled');
    expect(editorLineWrappingSelect).toHaveValue('disabled');
    expect(
      within(fontSizeSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['80%', '90%', '100% (Default)', '110%', '120%']);
    expect(
      within(uiFontSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['System', 'Hiragino Sans', 'Helvetica Neue', 'Avenir Next']);
    expect(
      within(codeFontSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['SF Mono', 'Menlo', 'Monaco']);
    expect(
      within(stageDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Show', 'Hide']);
    expect(
      within(conventionalCommitsSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(["Don't Use", 'Use']);
    expect(
      within(stickyFileHeadersSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['On', 'Off']);
    expect(
      within(editorLineWrappingSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Wrap', "Don't Wrap"]);
    expect(editorWrapColumnInput).toHaveValue(120);
    expect(repositoryBasePathInput).toHaveValue('/Users/example/Documents');
    expect(editorWrapColumnInput).toBeDisabled();
    expect(editorWrapColumnInput).toHaveAttribute(
      'aria-describedby',
      'editor-wrap-column-description',
    );
    expect(screen.queryByText('characters')).not.toBeInTheDocument();
    expect(toolchainSelect).toHaveValue('bundled');
    expect(screen.getByText('Current session')).toBeVisible();
    expect(screen.getByText('Next launch')).toBeVisible();
    await user.selectOptions(appearanceSelect, 'light');
    expect(onAppearanceChange).toHaveBeenCalledWith('light');
    await user.selectOptions(fontSizeSelect, '120');
    expect(onFontSizeChange).toHaveBeenCalledWith(120);
    await user.selectOptions(uiFontSelect, 'avenirNext');
    expect(onUiFontChange).toHaveBeenCalledWith('avenirNext');
    await user.selectOptions(codeFontSelect, 'menlo');
    expect(onCodeFontChange).toHaveBeenCalledWith('menlo');
    await user.selectOptions(languageSelect, 'ja');
    expect(onLanguageChange).toHaveBeenCalledWith('ja');
    await user.selectOptions(automaticUpdateChecksSelect, 'disabled');
    expect(onAutomaticUpdateChecksChange).toHaveBeenCalledWith(false);
    await user.selectOptions(diffLayoutSelect, 'split');
    expect(onDiffStyleChange).toHaveBeenCalledWith('split');
    expect(within(stageDisplaySelect).getByRole('option', { name: 'Show' })).toBeVisible();
    expect(within(stageDisplaySelect).getByRole('option', { name: 'Hide' })).toBeVisible();
    await user.selectOptions(stageDisplaySelect, 'hide');
    expect(onSplitStageViewChange).toHaveBeenCalledWith(false);
    expect(
      within(changeListDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Full Path', 'Tree', 'File Name and Path']);
    await user.selectOptions(changeListDisplaySelect, 'tree');
    expect(onChangeListDisplayChange).toHaveBeenCalledWith('tree');
    await user.selectOptions(conventionalCommitsSelect, 'enabled');
    expect(onUseConventionalCommitsChange).toHaveBeenCalledWith(true);
    await user.selectOptions(stickyFileHeadersSelect, 'enabled');
    expect(onStickyFileHeadersChange).toHaveBeenCalledWith(true);
    await user.selectOptions(editorLineWrappingSelect, 'enabled');
    expect(onEditorLineWrappingChange).toHaveBeenCalledWith(true);
    rerender(<SettingsView {...settingsProps} editorLineWrapping />);
    const enabledWrapColumnInput = screen.getByRole('spinbutton', { name: 'Wrap Length' });
    expect(enabledWrapColumnInput).toBeEnabled();
    await user.clear(enabledWrapColumnInput);
    await user.type(enabledWrapColumnInput, '100');
    expect(onEditorWrapColumnChange).toHaveBeenLastCalledWith(100);
    await user.clear(repositoryBasePathInput);
    await user.type(repositoryBasePathInput, 'relative/path');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute local path.');
    expect(onRepositoryBasePathChange).not.toHaveBeenCalled();
    await user.clear(repositoryBasePathInput);
    await user.type(repositoryBasePathInput, '/Users/example/Repositories');
    await user.tab();
    expect(onRepositoryBasePathChange).toHaveBeenCalledWith('/Users/example/Repositories');
    await user.selectOptions(toolchainSelect, 'system');
    expect(onToolchainModeChange).toHaveBeenCalledWith('system');

    const loadingSettingsProps = { ...settingsProps };
    delete loadingSettingsProps.toolchainStatus;
    rerender(<SettingsView {...loadingSettingsProps} />);
    const toolchain = screen.getByRole('region', { name: 'Git Toolchain' });
    expect(toolchain).toHaveAttribute('aria-busy', 'true');
    expect(toolchain).not.toHaveTextContent('Loading…');
    expect(toolchain.querySelectorAll('.settings-toolchain-modes > div')).toHaveLength(2);
    expect(toolchain.querySelectorAll('.settings-toolchain-components > div')).toHaveLength(3);
  });
});
