import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DirectoryInput } from './DirectoryInput';

describe('DirectoryInput', () => {
  it('combines a shared input with an accessible directory picker', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn<() => void>();
    render(
      <DirectoryInput
        aria-label="Repository path"
        value="/tmp/repository"
        pickerLabel="Choose Repository"
        onPick={onPick}
        readOnly
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Repository path' })).toHaveValue('/tmp/repository');
    const picker = screen.getByRole('button', { name: 'Choose Repository' });
    expect(picker).toHaveAttribute('title', 'Choose Repository');
    await user.click(picker);
    expect(onPick).toHaveBeenCalledOnce();
  });
});
