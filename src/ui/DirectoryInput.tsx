import { forwardRef } from 'react';

import { DirectoryPickerButton } from './DirectoryPickerButton';
import { Input, type InputProps } from './Input';

export interface DirectoryInputProps extends Omit<InputProps, 'type'> {
  pickerLabel: string;
  pickerDisabled?: boolean;
  onPick: () => void;
}

export const DirectoryInput = forwardRef<HTMLInputElement, DirectoryInputProps>(
  function DirectoryInput({ pickerLabel, pickerDisabled = false, onPick, ...inputProps }, ref) {
    return (
      <span className="directory-input-control">
        <Input ref={ref} {...inputProps} />
        <DirectoryPickerButton
          label={pickerLabel}
          iconOnly
          disabled={pickerDisabled}
          onClick={onPick}
        />
      </span>
    );
  },
);
