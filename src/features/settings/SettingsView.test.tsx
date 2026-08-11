import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from './SettingsView';

describe('SettingsView', () => {
  it('exposes stable appearance and language radio groups', async () => {
    const user = userEvent.setup();
    const onAppearanceChange = vi.fn<(appearance: 'system' | 'light' | 'dark') => void>();
    const onLanguageChange = vi.fn<(language: 'ja' | 'en') => void>();
    const onSplitStageViewChange = vi.fn<(split: boolean) => void>();
    render(
      <SettingsView
        appearance="system"
        language="en"
        splitStageView
        onAppearanceChange={onAppearanceChange}
        onLanguageChange={onLanguageChange}
        onSplitStageViewChange={onSplitStageViewChange}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('sr-only');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Language', 'Appearance', 'Stage Display']);
    expect(
      within(screen.getByRole('group', { name: 'Appearance' })).getAllByRole('radio'),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole('group', { name: 'Language' })).getAllByRole('radio'),
    ).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Separate' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onAppearanceChange).toHaveBeenCalledWith('light');
    await user.click(screen.getByRole('radio', { name: '日本語' }));
    expect(onLanguageChange).toHaveBeenCalledWith('ja');
    await user.click(screen.getByRole('radio', { name: 'Combined' }));
    expect(onSplitStageViewChange).toHaveBeenCalledWith(false);

    screen.getByRole('radio', { name: 'System' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onAppearanceChange).toHaveBeenLastCalledWith('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();

    screen.getByRole('radio', { name: 'English' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onLanguageChange).toHaveBeenLastCalledWith('ja');
    expect(screen.getByRole('radio', { name: '日本語' })).toHaveFocus();
  });
});
