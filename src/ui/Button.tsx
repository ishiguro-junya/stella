import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'dangerQuiet' | 'quiet';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: 'primary',
  danger: 'danger',
  dangerQuiet: 'danger-quiet',
  quiet: 'quiet',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', type = 'button', className, ...props },
  ref,
) {
  const classes = ['app-button', VARIANT_CLASS[variant], className].filter(Boolean).join(' ');
  return <button ref={ref} type={type} className={classes} {...props} />;
});
