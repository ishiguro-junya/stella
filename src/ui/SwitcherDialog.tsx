/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通ダイアログ内でフォーカスを管理し、ARIAの`combobox`と`listbox`の操作規則を実装する。 */
import { Check, Search } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { Button } from './Button';
import { Input } from './Input';
import { LoadingIndicator } from './LoadingIndicator';
import { useI18n } from '../i18n/i18n';
import { Dialog } from './Dialog';
import { RowActionMenu, type RowActionMenuItem, type RowActionMenuPoint } from './RowActionMenu';

export interface SwitcherDialogItem {
  id: string;
  label: string;
  description?: string;
  searchText: string;
  icon: ReactNode;
  current?: boolean;
  disabled?: boolean;
  actions?: readonly RowActionMenuItem<string>[];
  status?: {
    label: string;
    tone: 'danger' | 'muted' | 'warning';
  };
  badge?: {
    count: number;
    label: string;
  };
}

export interface SwitcherDialogProps {
  title: string;
  searchLabel: string;
  items: readonly SwitcherDialogItem[];
  loading?: boolean;
  emptyMessage: string;
  hint?: string;
  footer?: ReactNode;
  onDismiss: () => void;
  onSelect: (item: SwitcherDialogItem) => void;
  onAction?: (item: SwitcherDialogItem, action: string) => void;
}

interface OpenItemMenu {
  itemId: string;
  point?: RowActionMenuPoint;
}

function matchingItems(items: readonly SwitcherDialogItem[], query: string): SwitcherDialogItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => item.searchText.toLocaleLowerCase().includes(normalized));
}

function initialActiveId(items: readonly SwitcherDialogItem[]): string | undefined {
  return items.find((item) => item.current)?.id ?? items[0]?.id;
}

export function SwitcherDialog({
  title,
  searchLabel,
  items,
  loading = false,
  emptyMessage,
  hint,
  footer,
  onDismiss,
  onSelect,
  onAction,
}: SwitcherDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const listId = useId();
  const hintId = useId();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | undefined>(() => initialActiveId(items));
  const [focusedId, setFocusedId] = useState<string>();
  const [openMenu, setOpenMenu] = useState<OpenItemMenu>();
  const filteredItems = useMemo(() => matchingItems(items, query), [items, query]);
  const effectiveActiveId = filteredItems.some((item) => item.id === activeId)
    ? activeId
    : initialActiveId(filteredItems);
  const activeIndex = filteredItems.findIndex((item) => item.id === effectiveActiveId);
  const activeOptionId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;

  const moveActive = (nextIndex: number): void => {
    const next = filteredItems[nextIndex];
    if (next) setActiveId(next.id);
  };

  const focusOption = (nextIndex: number): void => {
    const next = filteredItems[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    optionRefs.current.get(next.id)?.focus();
  };

  const selectItem = (item: SwitcherDialogItem): void => {
    if (!item.disabled && !item.current) onSelect(item);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!filteredItems.length) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(Math.min(Math.max(activeIndex, -1) + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(Math.max(activeIndex - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        moveActive(0);
        break;
      case 'End':
        event.preventDefault();
        moveActive(filteredItems.length - 1);
        break;
      case 'Enter': {
        const active = filteredItems[activeIndex];
        if (!active) return;
        event.preventDefault();
        selectItem(active);
        break;
      }
    }
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    item: SwitcherDialogItem,
  ): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusOption(Math.min(index + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusOption(Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        focusOption(0);
        break;
      case 'End':
        event.preventDefault();
        focusOption(filteredItems.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        selectItem(item);
        break;
    }
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>, item: SwitcherDialogItem): void => {
    if (!item.actions?.length || !onAction) return;
    event.preventDefault();
    setActiveId(item.id);
    optionRefs.current.get(item.id)?.focus();
    setOpenMenu({ itemId: item.id, point: { x: event.clientX, y: event.clientY } });
  };

  const initialFocusId = items.find((item) => item.current)?.id;

  return (
    <Dialog
      labelledBy={titleId}
      describedBy={hint ? hintId : undefined}
      onDismiss={onDismiss}
      role="dialog"
      variant="switcher"
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      <label className="switcher-search">
        <Search aria-hidden="true" focusable="false" />
        <span className="sr-only">{searchLabel}</span>
        <Input
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-activedescendant={activeOptionId}
          aria-describedby={hint ? hintId : undefined}
          autoComplete="off"
          data-dialog-initial-focus={initialFocusId ? undefined : true}
          placeholder={searchLabel}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            const nextItems = matchingItems(items, nextQuery);
            setQuery(nextQuery);
            setActiveId(initialActiveId(nextItems));
            setOpenMenu(undefined);
          }}
          onKeyDown={handleSearchKeyDown}
        />
      </label>
      {hint ? (
        <p id={hintId} className="switcher-hint">
          {hint}
        </p>
      ) : null}
      <div
        id={listId}
        className="switcher-list"
        role="listbox"
        aria-label={title}
        aria-busy={loading}
      >
        {filteredItems.length ? (
          filteredItems.map((item, index) => {
            const selected = item.id === effectiveActiveId;
            return (
              <div
                key={item.id}
                role="presentation"
                className={`switcher-option-row${selected ? ' is-selected' : ''}${focusedId === item.id ? ' is-focused' : ''}${item.disabled ? ' is-disabled' : ''}${item.actions?.length ? ' has-actions' : ''}`}
                onFocusCapture={() => setFocusedId(item.id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(undefined);
                }}
                onMouseEnter={() => setActiveId(item.id)}
                onContextMenu={(event) => openContextMenu(event, item)}
              >
                <Button
                  ref={(node) => {
                    if (node) optionRefs.current.set(item.id, node);
                    else optionRefs.current.delete(item.id);
                  }}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-current={item.current ? 'true' : undefined}
                  aria-disabled={item.disabled || undefined}
                  className="switcher-option"
                  data-switcher-item-label={item.label}
                  data-dialog-initial-focus={item.id === initialFocusId ? true : undefined}
                  onFocus={() => setActiveId(item.id)}
                  onClick={() => setActiveId(item.id)}
                  onDoubleClick={() => selectItem(item)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index, item)}
                >
                  <span className="switcher-check" aria-hidden="true">
                    {item.current ? <Check /> : null}
                  </span>
                  <span className="switcher-option-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="switcher-option-copy">
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  {item.status ? (
                    <span className="switcher-status">
                      <span
                        className={`switcher-status-dot ${item.status.tone}`}
                        aria-hidden="true"
                      />
                      <small>{item.status.label}</small>
                    </span>
                  ) : null}
                  {item.badge ? (
                    <span className="switcher-count-badge" aria-label={item.badge.label}>
                      {item.badge.count}
                    </span>
                  ) : null}
                </Button>
                {item.actions?.length && onAction ? (
                  <RowActionMenu
                    triggerLabel={t('moreActionsFor', { path: item.label })}
                    triggerTitle={t('moreActions')}
                    menuLabel={t('fileActionsFor', { path: item.label })}
                    items={item.actions}
                    open={openMenu?.itemId === item.id}
                    disabled={false}
                    contextPoint={openMenu?.itemId === item.id ? openMenu.point : undefined}
                    triggerClassName="switcher-action-trigger is-persistent"
                    onOpenChange={(open) => setOpenMenu(open ? { itemId: item.id } : undefined)}
                    onTriggerOpen={() => setActiveId(item.id)}
                    getActionFocusTarget={() => optionRefs.current.get(item.id)}
                    getCloseFocusTarget={() => optionRefs.current.get(item.id)}
                    onAction={(action) => onAction(item, action)}
                  />
                ) : null}
              </div>
            );
          })
        ) : loading ? null : (
          <p className="switcher-empty">{emptyMessage}</p>
        )}
        {loading ? <LoadingIndicator className="switcher-loading" /> : null}
      </div>
      {footer ? <div className="switcher-footer">{footer}</div> : null}
    </Dialog>
  );
}
