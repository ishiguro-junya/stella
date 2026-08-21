import { X } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  type FormEventHandler,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { Button } from './Button';
import { useI18n } from '../i18n/i18n';

export interface DialogProps {
  labelledBy: string;
  describedBy?: string | undefined;
  className?: string | undefined;
  onDismiss: () => void;
  children: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement> | undefined;
  role?: 'alertdialog' | 'dialog';
  variant?: 'confirmation' | 'switcher';
  dismissible?: boolean;
}

export function DialogHeader({
  titleId,
  title,
  descriptionId,
  description,
}: {
  titleId: string;
  title: ReactNode;
  descriptionId?: string | undefined;
  description?: ReactNode;
}) {
  return (
    <header className="dialog-header">
      <h2 id={titleId}>{title}</h2>
      {description ? <p id={descriptionId}>{description}</p> : null}
    </header>
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`dialog-body${className ? ` ${className}` : ''}`} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <footer className={`dialog-footer${className ? ` ${className}` : ''}`} {...props} />;
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
  returnFocus: HTMLElement | null;
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
  dismissible = true,
}: DialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement | null>(null);
  const dialogId = useRef(Symbol(labelledBy));
  const dismissRef = useRef(onDismiss);
  const dismissibleRef = useRef(dismissible);
  dismissRef.current = onDismiss;
  dismissibleRef.current = dismissible;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return () => undefined;
    const previous = dialogStack.at(-1);
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { id: dialogId.current, element: dialog, returnFocus };
    if (previous) setDialogInteractive(previous.element, false);
    dialogStack.push(entry);
    const initial =
      dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);
    (initial ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (dialogStack.at(-1)?.id !== entry.id) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismissibleRef.current) dismissRef.current();
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
      const [removed] = index >= 0 ? dialogStack.splice(index, 1) : [];
      if (wasTop) {
        const next = dialogStack.at(-1);
        if (next) setDialogInteractive(next.element, true);
        entry.returnFocus?.focus();
      } else {
        const top = dialogStack.at(-1);
        if (removed && top?.returnFocus && removed.element.contains(top.returnFocus)) {
          top.returnFocus = removed.returnFocus;
        }
      }
    };
  }, [labelledBy]);

  return (
    <div
      className={`modal-backdrop${variant === 'switcher' ? ' switcher-backdrop' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        const target = event.target;
        if (
          variant === 'switcher' &&
          target instanceof Element &&
          !target.closest(`label,${FOCUSABLE}`)
        ) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (
          dismissible &&
          event.target === event.currentTarget &&
          dialogStack.at(-1)?.id === dialogId.current
        )
          onDismiss();
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
          tabIndex={variant === 'switcher' ? undefined : -1}
          onSubmit={onSubmit}
        >
          {children}
          {variant !== 'switcher' ? (
            <Button
              type="button"
              className="dialog-close-button"
              aria-label={t('closeDialog')}
              tooltip={t('closeDialog')}
              disabled={!dismissible}
              onClick={onDismiss}
            >
              <X aria-hidden="true" focusable="false" />
            </Button>
          ) : null}
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
          tabIndex={variant === 'switcher' ? undefined : -1}
        >
          {children}
          {variant !== 'switcher' ? (
            <Button
              type="button"
              className="dialog-close-button"
              aria-label={t('closeDialog')}
              tooltip={t('closeDialog')}
              disabled={!dismissible}
              onClick={onDismiss}
            >
              <X aria-hidden="true" focusable="false" />
            </Button>
          ) : null}
        </section>
      )}
    </div>
  );
}
