import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { Tooltip } from './Tooltip';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'dangerQuiet' | 'quiet';

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'title'> {
  variant?: ButtonVariant;
  tooltip?: string | undefined;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: 'primary',
  danger: 'danger',
  dangerQuiet: 'danger-quiet',
  quiet: 'quiet',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', type = 'button', className, tooltip, ...props },
  ref,
) {
  const classes = ['app-button', VARIANT_CLASS[variant], className].filter(Boolean).join(' ');
  const button = <button ref={ref} type={type} className={classes} {...props} />;
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
});
