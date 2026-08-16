import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Button, type ButtonProps } from './Button';

export interface ToggleButtonProps extends Omit<
  ButtonProps,
  'aria-pressed' | 'children' | 'onClick' | 'variant'
> {
  pressed: boolean;
  offIcon: LucideIcon;
  onIcon: LucideIcon;
  reverseIcons?: boolean | undefined;
  onPressedChange: (pressed: boolean) => void;
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  {
    pressed,
    offIcon: OffIcon,
    onIcon: OnIcon,
    reverseIcons = false,
    onPressedChange,
    className,
    ...props
  },
  ref,
) {
  const classes = ['toggle-button', className].filter(Boolean).join(' ');
  const FirstIcon = reverseIcons ? OnIcon : OffIcon;
  const SecondIcon = reverseIcons ? OffIcon : OnIcon;
  const firstSelected = reverseIcons ? pressed : !pressed;
  return (
    <Button
      {...props}
      ref={ref}
      variant="quiet"
      className={classes}
      aria-pressed={pressed}
      data-reverse-icons={reverseIcons || undefined}
      onClick={() => onPressedChange(!pressed)}
    >
      <span className="toggle-button-thumb" aria-hidden="true" />
      <span className={`toggle-button-option${firstSelected ? ' is-selected' : ''}`}>
        <FirstIcon aria-hidden="true" focusable="false" />
      </span>
      <span className={`toggle-button-option${firstSelected ? '' : ' is-selected'}`}>
        <SecondIcon aria-hidden="true" focusable="false" />
      </span>
    </Button>
  );
});
