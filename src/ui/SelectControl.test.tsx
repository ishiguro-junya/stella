import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SelectControl } from './SelectControl';

describe('SelectControl', () => {
  it('selectの操作とclass名を内側の余白用wrapperから維持する', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(event: ChangeEvent<HTMLSelectElement>) => void>();
    const { container } = render(
      <SelectControl className="settings-select" aria-label="表示" onChange={onChange}>
        <option value="first">1件目</option>
        <option value="second">2件目</option>
      </SelectControl>,
    );

    const select = screen.getByRole('combobox', { name: '表示' });
    await user.selectOptions(select, 'second');

    expect(onChange).toHaveBeenCalledOnce();
    expect(container.querySelector('.select-control.settings-select')).toContainElement(select);
    expect(container.querySelector('.select-control > .lucide-chevron-down')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
