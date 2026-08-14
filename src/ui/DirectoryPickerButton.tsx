import { FolderOpen } from 'lucide-react';

import { Button, type ButtonProps } from './Button';

export interface DirectoryPickerButtonProps extends Omit<
  ButtonProps,
  'aria-label' | 'children' | 'title'
> {
  label: string;
  iconOnly?: boolean;
}

export function DirectoryPickerButton({
  label,
  iconOnly = false,
  className,
  ...props
}: DirectoryPickerButtonProps) {
  const classes = ['directory-picker-button', iconOnly ? 'is-icon-only' : undefined, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Button className={classes} aria-label={label} title={iconOnly ? label : undefined} {...props}>
      <FolderOpen aria-hidden="true" focusable="false" />
      {iconOnly ? null : label}
    </Button>
  );
}
