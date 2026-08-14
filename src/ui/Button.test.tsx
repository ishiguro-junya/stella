import { render, screen } from '@testing-library/react';
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
});
