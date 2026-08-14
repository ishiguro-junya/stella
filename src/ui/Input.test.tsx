import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Input } from './Input';

describe('Input', () => {
  it('applies the shared input contract while preserving native props', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Name" className="custom" disabled />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveClass('app-input', 'custom');
    expect(input).toBeDisabled();
    expect(ref.current).toBe(input);
  });
});
