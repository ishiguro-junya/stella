import { useEffect, useRef, type FormEventHandler, type ReactNode } from 'react';

export interface DialogProps {
  labelledBy: string;
  describedBy?: string | undefined;
  className?: string | undefined;
  onDismiss: () => void;
  children: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement> | undefined;
  role?: 'alertdialog' | 'dialog';
  variant?: 'confirmation' | 'switcher';
}

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

interface DialogStackEntry {
  id: symbol;
  element: HTMLElement;
}

const dialogStack: DialogStackEntry[] = [];

function setDialogInteractive(element: HTMLElement, interactive: boolean): void {
  element.inert = !interactive;
  if (interactive) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', 'true');
}

export function Dialog({
  labelledBy,
  describedBy,
  className,
  onDismiss,
  children,
  onSubmit,
  role = 'alertdialog',
  variant = 'confirmation',
}: DialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return () => undefined;
    const entry = { id: Symbol(labelledBy), element: dialog };
    const previous = dialogStack.at(-1);
    if (previous) setDialogInteractive(previous.element, false);
    dialogStack.push(entry);
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial =
      dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (dialogStack.at(-1)?.id !== entry.id) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = dialogStack.findIndex((candidate) => candidate.id === entry.id);
      const wasTop = index === dialogStack.length - 1;
      if (index >= 0) dialogStack.splice(index, 1);
      if (wasTop) {
        const next = dialogStack.at(-1);
        if (next) setDialogInteractive(next.element, true);
        returnFocus?.focus();
      }
    };
  }, [labelledBy]);

  return (
    <div
      className={`modal-backdrop${variant === 'switcher' ? ' switcher-backdrop' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (variant === 'switcher' && event.target === event.currentTarget) onDismiss();
      }}
    >
      {onSubmit ? (
        <form
          ref={(node) => {
            dialogRef.current = node;
          }}
          className={`confirmation-sheet${variant === 'switcher' ? ' switcher-sheet' : ''}${className ? ` ${className}` : ''}`}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onSubmit={onSubmit}
        >
          {children}
        </form>
      ) : (
        <section
          ref={(node) => {
            dialogRef.current = node;
          }}
          className={`confirmation-sheet${variant === 'switcher' ? ' switcher-sheet' : ''}${className ? ` ${className}` : ''}`}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
        >
          {children}
        </section>
      )}
    </div>
  );
}
