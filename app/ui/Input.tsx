import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type InputProps = ComponentPropsWithoutRef<'input'>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { type = 'text', className, ...props },
  ref,
) {
  const classes = ['app-input', className].filter(Boolean).join(' ');
  return <input ref={ref} type={type} className={classes} {...props} />;
});
