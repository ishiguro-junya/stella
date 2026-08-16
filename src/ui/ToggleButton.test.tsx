import { fireEvent, render, screen } from '@testing-library/react';
import { Lock, Pencil } from 'lucide-react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToggleButton } from './ToggleButton';

describe('ToggleButton', () => {
  it('publishes its pressed state and requests the opposite state when clicked', () => {
    const onPressedChange = vi.fn<(pressed: boolean) => void>();
    const ref = createRef<HTMLButtonElement>();
    const view = render(
      <ToggleButton
        ref={ref}
        aria-label="Mode"
        pressed={false}
        offIcon={Lock}
        onIcon={Pencil}
        className="custom"
        onPressedChange={onPressedChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Mode' });
    const options = button.querySelectorAll('.toggle-button-option');
    expect(button).toHaveClass('app-button', 'quiet', 'toggle-button', 'custom');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('.toggle-button-thumb')).toBeInTheDocument();
    expect(options[0]).toHaveClass('is-selected');
    expect(options[1]).not.toHaveClass('is-selected');
    expect(ref.current).toBe(button);

    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    view.rerender(
      <ToggleButton
        aria-label="Mode"
        pressed
        offIcon={Lock}
        onIcon={Pencil}
        onPressedChange={onPressedChange}
      />,
    );
    const selected = screen
      .getByRole('button', { name: 'Mode' })
      .querySelectorAll('.toggle-button-option');
    expect(selected[0]).not.toHaveClass('is-selected');
    expect(selected[1]).toHaveClass('is-selected');
  });

  it('can place the on icon first without changing the pressed state', () => {
    render(
      <ToggleButton
        aria-label="Mode"
        pressed
        offIcon={Lock}
        onIcon={Pencil}
        reverseIcons
        onPressedChange={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: 'Mode' });
    const options = button.querySelectorAll('.toggle-button-option');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-reverse-icons', 'true');
    expect(options[0]).toHaveClass('is-selected');
    expect(options[1]).not.toHaveClass('is-selected');
  });
});
