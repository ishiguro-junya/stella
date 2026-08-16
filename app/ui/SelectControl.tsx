import { ChevronDown } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const SelectControl = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(
  function SelectControl({ className, ...props }, ref) {
    return (
      <span className={className ? `select-control ${className}` : 'select-control'}>
        <select ref={ref} className="app-select" {...props} />
        <ChevronDown aria-hidden="true" focusable="false" />
      </span>
    );
  },
);
