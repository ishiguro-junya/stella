import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';

export function SelectControl({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <span className={className ? `select-control ${className}` : 'select-control'}>
      <select {...props} />
      <ChevronDown aria-hidden="true" focusable="false" />
    </span>
  );
}
