import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { LoaderCircle } from 'lucide-react';

import { Tooltip } from './Tooltip';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'dangerQuiet' | 'quiet';

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'title'> {
  variant?: ButtonVariant;
  tooltip?: string | undefined;
  loading?: boolean | undefined;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: 'primary',
  danger: 'danger',
  dangerQuiet: 'danger-quiet',
  quiet: 'quiet',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', type = 'button', className, tooltip, loading = false, children, ...props },
  ref,
) {
  const classes = ['app-button', VARIANT_CLASS[variant], className].filter(Boolean).join(' ');
  const button = (
    <button
      ref={ref}
      type={type}
      className={classes}
      {...props}
      aria-busy={loading || props['aria-busy']}
    >
      {loading ? (
        <LoaderCircle
          className="button-loading-icon delayed-loading-icon"
          aria-hidden="true"
          focusable="false"
        />
      ) : null}
      {children}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
});
