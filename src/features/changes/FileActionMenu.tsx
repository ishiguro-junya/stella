import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AppWindowMac, Copy, Ellipsis, FolderOpen, Trash2, Undo2 } from 'lucide-react';

import { useI18n } from '../../i18n/i18n';

export type FileActionKind =
  | 'openInDefaultApp'
  | 'revealInFinder'
  | 'copyPath'
  | 'discardChanges'
  | 'moveToTrash';

export interface FileActionMenuPoint {
  x: number;
  y: number;
}

export interface FileActionMenuProps {
  path: string;
  selectedPaths: string[];
  open: boolean;
  disabled: boolean;
  openDisabled: boolean;
  discardDisabled: boolean;
  deleteDisabled: boolean;
  contextPoint?: FileActionMenuPoint | undefined;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  onAction: (action: FileActionKind) => Promise<void>;
}

type InitialFocus = 'first' | 'last';

interface MenuPosition {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;
const DOCUMENT_TAB_STOP = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

function enabledItems(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
}

export function FileActionMenu({
  path,
  selectedPaths,
  open,
  disabled,
  openDisabled,
  discardDisabled,
  deleteDisabled,
  contextPoint,
  onOpenChange,
  onTriggerOpen,
  onAction,
}: FileActionMenuProps) {
  const { t } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<InitialFocus>('first');
  const [position, setPosition] = useState<MenuPosition>();

  const positionMenu = useCallback((): void => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - menuRect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - menuRect.height - VIEWPORT_MARGIN,
    );
    const triggerRect = trigger.getBoundingClientRect();
    const left = contextPoint
      ? Math.min(Math.max(VIEWPORT_MARGIN, contextPoint.x), maxLeft)
      : Math.min(Math.max(VIEWPORT_MARGIN, triggerRect.right - menuRect.width), maxLeft);
    const below = contextPoint ? contextPoint.y : triggerRect.bottom + MENU_GAP;
    const above = contextPoint
      ? contextPoint.y - menuRect.height
      : triggerRect.top - menuRect.height - MENU_GAP;
    const top =
      below + menuRect.height <= window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, below)
        : Math.min(Math.max(VIEWPORT_MARGIN, above), maxTop);
    setPosition({ left, top });
  }, [contextPoint]);

  const closeMenu = useCallback(
    (restoreFocus: boolean): void => {
      onOpenChange(false);
      setPosition(undefined);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  const openMenu = (initialFocus: InitialFocus): void => {
    initialFocusRef.current = initialFocus;
    setPosition(undefined);
    onOpenChange(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    const menu = menuRef.current;
    if (!menu) return;
    const items = enabledItems(menu);
    const target = initialFocusRef.current === 'last' ? items.at(-1) : items[0];
    target?.focus();
  }, [open, positionMenu]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const reposition = (): void => positionMenu();

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [closeMenu, open, positionMenu]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const menu = menuRef.current;
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const trigger = triggerRef.current;
      const menuItems = menuRef.current;
      const tabStops = [...document.querySelectorAll<HTMLElement>(DOCUMENT_TAB_STOP)].filter(
        (candidate) => !menuItems?.contains(candidate),
      );
      const triggerIndex = trigger ? tabStops.indexOf(trigger) : -1;
      const destination =
        triggerIndex < 0 ? undefined : tabStops[triggerIndex + (event.shiftKey ? -1 : 1)];
      closeMenu(false);
      destination?.focus();
      return;
    }

    const items = enabledItems(menu);
    if (!items.length) return;
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    let target: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = items[(activeIndex + 1) % items.length];
        break;
      case 'ArrowUp':
        target = items[(activeIndex - 1 + items.length) % items.length];
        break;
      case 'Home':
        target = items[0];
        break;
      case 'End':
        target = items.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  };

  const runAction = (action: FileActionKind): void => {
    const trigger = triggerRef.current;
    const row = trigger?.closest('.change-item')?.querySelector<HTMLButtonElement>('.change-row');
    closeMenu(false);
    (row ?? trigger)?.focus();
    void onAction(action).catch(() => undefined);
  };

  const menuStyle: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, visibility: 'hidden' };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="file-action-trigger quiet"
        aria-label={t('moreActionsFor', { path })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t('moreActions')}
        disabled={disabled}
        onClick={() => {
          if (open) closeMenu(false);
          else {
            onTriggerOpen();
            openMenu('first');
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onTriggerOpen();
            openMenu('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            onTriggerOpen();
            openMenu('last');
          }
        }}
      >
        <Ellipsis aria-hidden="true" focusable="false" size={16} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="file-action-menu"
              role="menu"
              aria-label={
                selectedPaths.length === 1
                  ? t('fileActionsFor', { path: selectedPaths[0] ?? path })
                  : t('selectedFileActions', { count: selectedPaths.length })
              }
              tabIndex={-1}
              style={menuStyle}
              onKeyDown={handleMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                disabled={openDisabled}
                onClick={() => runAction('openInDefaultApp')}
              >
                <AppWindowMac aria-hidden="true" focusable="false" size={15} />
                <span>{t('openInDefaultApp')}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runAction('revealInFinder')}>
                <FolderOpen aria-hidden="true" focusable="false" size={15} />
                <span>{t('showInFinder')}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runAction('copyPath')}>
                <Copy aria-hidden="true" focusable="false" size={15} />
                <span>{t('copyPath')}</span>
              </button>
              <hr className="file-action-menu-separator" />
              <button
                type="button"
                className="danger-menu-item"
                role="menuitem"
                disabled={discardDisabled}
                onClick={() => runAction('discardChanges')}
              >
                <Undo2 aria-hidden="true" focusable="false" size={15} />
                <span>{t('discardFilesEllipsis')}</span>
              </button>
              <button
                type="button"
                className="danger-menu-item"
                role="menuitem"
                disabled={deleteDisabled}
                onClick={() => runAction('moveToTrash')}
              >
                <Trash2 aria-hidden="true" focusable="false" size={15} />
                <span>{t('deleteFilesEllipsis')}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
