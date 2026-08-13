import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis } from 'lucide-react';

export interface RowActionMenuPoint {
  x: number;
  y: number;
}

export interface RowActionMenuItem<Action extends string> {
  action: Action;
  label: string;
  icon: ReactNode;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
  separatorBefore?: boolean | undefined;
}

export interface RowActionMenuProps<Action extends string> {
  triggerLabel: string;
  triggerTitle: string;
  menuLabel: string;
  items: readonly RowActionMenuItem<Action>[];
  open: boolean;
  disabled: boolean;
  contextPoint?: RowActionMenuPoint | undefined;
  contextOnly?: boolean | undefined;
  triggerClassName?: string | undefined;
  menuClassName?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  onAction: (action: Action) => void | Promise<void>;
  getActionFocusTarget?:
    | ((trigger: HTMLButtonElement) => HTMLElement | null | undefined)
    | undefined;
  getCloseFocusTarget?:
    | ((trigger: HTMLButtonElement) => HTMLElement | null | undefined)
    | undefined;
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

export function RowActionMenu<Action extends string>({
  triggerLabel,
  triggerTitle,
  menuLabel,
  items,
  open,
  disabled,
  contextPoint,
  contextOnly = false,
  triggerClassName,
  menuClassName,
  onOpenChange,
  onTriggerOpen,
  onAction,
  getActionFocusTarget,
  getCloseFocusTarget,
}: RowActionMenuProps<Action>) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<InitialFocus>('first');
  const [position, setPosition] = useState<MenuPosition>();

  const positionMenu = useCallback((): void => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!menu || (!trigger && !contextPoint)) return;
    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - menuRect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - menuRect.height - VIEWPORT_MARGIN,
    );
    const triggerRect = trigger?.getBoundingClientRect();
    const left = contextPoint
      ? Math.min(Math.max(VIEWPORT_MARGIN, contextPoint.x), maxLeft)
      : Math.min(
          Math.max(VIEWPORT_MARGIN, (triggerRect?.right ?? VIEWPORT_MARGIN) - menuRect.width),
          maxLeft,
        );
    const below = contextPoint
      ? contextPoint.y
      : (triggerRect?.bottom ?? VIEWPORT_MARGIN) + MENU_GAP;
    const above = contextPoint
      ? contextPoint.y - menuRect.height
      : (triggerRect?.top ?? VIEWPORT_MARGIN) - menuRect.height - MENU_GAP;
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
      const trigger = triggerRef.current;
      if (restoreFocus && trigger) (getCloseFocusTarget?.(trigger) ?? trigger).focus();
    },
    [getCloseFocusTarget, onOpenChange],
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
    const enabled = enabledItems(menu);
    const target = initialFocusRef.current === 'last' ? enabled.at(-1) : enabled[0];
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
      const tabStops = [...document.querySelectorAll<HTMLElement>(DOCUMENT_TAB_STOP)].filter(
        (candidate) => !menu.contains(candidate),
      );
      const triggerIndex = triggerRef.current ? tabStops.indexOf(triggerRef.current) : -1;
      const destination =
        triggerIndex < 0 ? undefined : tabStops[triggerIndex + (event.shiftKey ? -1 : 1)];
      closeMenu(false);
      destination?.focus();
      return;
    }

    const enabled = enabledItems(menu);
    if (!enabled.length) return;
    const activeIndex = enabled.findIndex((item) => item === document.activeElement);
    let target: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = enabled[(activeIndex + 1) % enabled.length];
        break;
      case 'ArrowUp':
        target = enabled[(activeIndex - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        target = enabled[0];
        break;
      case 'End':
        target = enabled.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  };

  const runAction = (action: Action): void => {
    const trigger = triggerRef.current;
    closeMenu(false);
    (trigger ? (getActionFocusTarget?.(trigger) ?? trigger) : undefined)?.focus();
    void Promise.resolve(onAction(action)).catch(() => undefined);
  };

  const menuStyle: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, visibility: 'hidden' };

  return (
    <>
      {contextOnly ? null : (
        <button
          ref={triggerRef}
          type="button"
          className={`row-action-trigger quiet${triggerClassName ? ` ${triggerClassName}` : ''}`}
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          title={triggerTitle}
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
      )}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className={`row-action-menu${menuClassName ? ` ${menuClassName}` : ''}`}
              role="menu"
              aria-label={menuLabel}
              tabIndex={-1}
              style={menuStyle}
              onKeyDown={handleMenuKeyDown}
            >
              {items.map((item) => (
                <div key={item.action} className="row-action-menu-entry">
                  {item.separatorBefore ? <hr className="row-action-menu-separator" /> : null}
                  <button
                    type="button"
                    className={item.danger ? 'danger-menu-item' : undefined}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => runAction(item.action)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
