/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 調整可能なARIA separatorにはpointerとkeyboard操作が必要。 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface PaneResizerProps {
  label: string;
  value: number;
  direction: 'growRight' | 'growLeft';
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

export function PaneResizer({
  label,
  value,
  direction,
  min = 180,
  max = 520,
  onChange,
}: PaneResizerProps) {
  const dragRef = useRef<{ pointerX: number; value: number } | null>(null);

  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { pointerX: event.clientX, value };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - start.pointerX;
    onChange(clamp(start.value + (direction === 'growRight' ? delta : -delta)));
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 24 : 8;
    const directionMultiplier = direction === 'growRight' ? 1 : -1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(clamp(value - step * directionMultiplier));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(clamp(value + step * directionMultiplier));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      role="separator"
      className="pane-resizer"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    />
  );
}
