import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from './Tooltip';

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('delays pointer display, preserves descriptions, and flips below near the viewport edge', async () => {
    vi.useFakeTimers();
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        return this.getAttribute('role') === 'tooltip'
          ? new DOMRect(0, 0, 120, 40)
          : new DOMRect(12, 4, 30, 30);
      });
    render(
      <Tooltip content="Add to library">
        <button type="button" title="Native tooltip" aria-describedby="existing-description">
          Hover
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Hover' });

    expect(trigger).not.toHaveAttribute('title');
    fireEvent.pointerEnter(trigger);
    await act(async () => vi.advanceTimersByTime(299));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Add to library');
    expect(tooltip).toHaveAttribute('data-side', 'bottom');
    expect(trigger.getAttribute('aria-describedby')).toContain('existing-description');
    expect(trigger.getAttribute('aria-describedby')).toContain(tooltip.id);

    fireEvent.pointerLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    rect.mockRestore();
  });

  it('shows immediately on focus and closes on Escape, click, and blur', () => {
    render(
      <Tooltip content="Focused tooltip">
        <button type="button">Focus</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Focus' });

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Focused tooltip');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Focused tooltip');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
