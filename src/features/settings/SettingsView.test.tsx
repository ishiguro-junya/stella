import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from './SettingsView';

describe('SettingsView', () => {
  it('exposes every setting as a select box', async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn<(appearance: 'system' | 'light' | 'dark') => void>();
    const onLanguageChange = vi.fn<(language: 'ja' | 'en') => void>();
    const onDiffStyleChange = vi.fn<(style: 'unified' | 'split') => void>();
    const onSplitStageViewChange = vi.fn<(split: boolean) => void>();
    const onToolchainModeChange = vi.fn<(mode: 'bundled' | 'system') => void>();
    render(
      <SettingsView
        appearance="system"
        language="en"
        diffStyle="unified"
        splitStageView
        toolchainStatus={{
          activeMode: 'bundled',
          selectedMode: 'bundled',
          restartRequired: false,
          git: { available: true, path: '/app/git', version: 'git version 2.55.0', error: null },
          gitLfs: { available: true, path: '/app/git-lfs', version: 'git-lfs/3.7.1', error: null },
          gitFlow: { available: true, path: '/app/git-flow', version: '1.2.0', error: null },
          gpgAvailable: true,
        }}
        onAppearanceChange={onAppearanceChange}
        onLanguageChange={onLanguageChange}
        onDiffStyleChange={onDiffStyleChange}
        onSplitStageViewChange={onSplitStageViewChange}
        onToolchainModeChange={onToolchainModeChange}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('sr-only');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Language', 'Appearance', 'Diff layout', 'Stage Display', 'Git Toolchain']);
    const languageSelect = screen.getByRole('combobox', { name: 'Language' });
    const appearanceSelect = screen.getByRole('combobox', { name: 'Appearance' });
    const diffLayoutSelect = screen.getByRole('combobox', { name: 'Diff layout' });
    const stageDisplaySelect = screen.getByRole('combobox', { name: 'Stage Display' });
    const toolchainSelect = screen.getByRole('combobox', { name: 'Git Toolchain' });
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    expect(languageSelect).toHaveValue('en');
    expect(appearanceSelect).toHaveValue('system');
    expect(diffLayoutSelect).toHaveValue('unified');
    expect(stageDisplaySelect).toHaveValue('split');
    expect(toolchainSelect).toHaveValue('bundled');
    expect(screen.getByText('Current session')).toBeVisible();
    expect(screen.getByText('Next launch')).toBeVisible();
    await user.selectOptions(appearanceSelect, 'light');
    expect(onAppearanceChange).toHaveBeenCalledWith('light');
    await user.selectOptions(languageSelect, 'ja');
    expect(onLanguageChange).toHaveBeenCalledWith('ja');
    await user.selectOptions(diffLayoutSelect, 'split');
    expect(onDiffStyleChange).toHaveBeenCalledWith('split');
    await user.selectOptions(stageDisplaySelect, 'combined');
    expect(onSplitStageViewChange).toHaveBeenCalledWith(false);
    await user.selectOptions(toolchainSelect, 'system');
    expect(onToolchainModeChange).toHaveBeenCalledWith('system');
  });
});
