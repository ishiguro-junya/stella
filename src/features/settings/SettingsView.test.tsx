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
    const onAutomaticUpdateChecksChange = vi.fn<(enabled: boolean) => void>();
    const onDiffStyleChange = vi.fn<(style: 'unified' | 'split') => void>();
    const onSplitStageViewChange = vi.fn<(split: boolean) => void>();
    const onUseConventionalCommitsChange = vi.fn<(enabled: boolean) => void>();
    const onStickyFileHeadersChange = vi.fn<(sticky: boolean) => void>();
    const onEditorLineWrappingChange = vi.fn<(enabled: boolean) => void>();
    const onEditorWrapColumnChange = vi.fn<(column: number) => void>();
    const onToolchainModeChange = vi.fn<(mode: 'bundled' | 'system') => void>();
    const settingsProps: ComponentProps<typeof SettingsView> = {
      appearance: 'system',
      language: 'en',
      automaticUpdateChecks: true,
      diffStyle: 'unified',
      splitStageView: true,
      useConventionalCommits: false,
      stickyFileHeaders: false,
      editorLineWrapping: false,
      editorWrapColumn: 120,
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
      onAutomaticUpdateChecksChange,
      onDiffStyleChange,
      onSplitStageViewChange,
      onUseConventionalCommitsChange,
      onStickyFileHeadersChange,
      onEditorLineWrappingChange,
      onEditorWrapColumnChange,
      onToolchainModeChange,
    };
    const { rerender } = render(<SettingsView {...settingsProps} />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('sr-only');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Language',
      'Appearance',
      'Automatic Updates',
      'Diff layout',
      'Stage Display',
      'Conventional Commits',
      'Sticky File Headers',
      'Line Wrapping',
      'Wrap Length',
      'Git Toolchain',
    ]);
    const languageSelect = screen.getByRole('combobox', { name: 'Language' });
    const appearanceSelect = screen.getByRole('combobox', { name: 'Appearance' });
    const automaticUpdateChecksSelect = screen.getByRole('combobox', {
      name: 'Automatic Updates',
    });
    const diffLayoutSelect = screen.getByRole('combobox', { name: 'Diff layout' });
    const stageDisplaySelect = screen.getByRole('combobox', { name: 'Stage Display' });
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
    const toolchainSelect = screen.getByRole('combobox', { name: 'Git Toolchain' });
    expect(screen.getAllByRole('combobox')).toHaveLength(9);
    expect(languageSelect).toHaveValue('en');
    expect(appearanceSelect).toHaveValue('system');
    expect(automaticUpdateChecksSelect).toHaveValue('enabled');
    expect(diffLayoutSelect).toHaveValue('unified');
    expect(stageDisplaySelect).toHaveValue('show');
    expect(conventionalCommitsSelect).toHaveValue('disabled');
    expect(stickyFileHeadersSelect).toHaveValue('disabled');
    expect(editorLineWrappingSelect).toHaveValue('disabled');
    expect(
      within(stageDisplaySelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Show', 'Hide']);
    expect(
      within(conventionalCommitsSelect)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Use', "Don't Use"]);
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
    await user.selectOptions(toolchainSelect, 'system');
    expect(onToolchainModeChange).toHaveBeenCalledWith('system');
  });
});
