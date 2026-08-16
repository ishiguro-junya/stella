import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('applies the shared button contract while preserving native props', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} variant="primary" className="custom" disabled>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('app-button', 'primary', 'custom');
    expect(button).toBeDisabled();
    expect(ref.current).toBe(button);
  });

  it('renders its tooltip without a native title', () => {
    render(<Button tooltip="Save changes">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });

    expect(button).not.toHaveAttribute('title');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save changes');
  });

  it('places the delayed loading icon before the unchanged label', () => {
    render(<Button loading>Saving…</Button>);

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.firstElementChild).toHaveClass('button-loading-icon', 'delayed-loading-icon');
  });
});
