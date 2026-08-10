/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 検索可能なswitcherは共通modalのfocus trap内でARIA combobox/listbox patternを使用する。 */
import { Check, Search } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useI18n } from '../i18n/i18n';
import { Dialog } from './Dialog';

export interface SwitcherDialogItem {
  id: string;
  label: string;
  description?: string;
  searchText: string;
  icon: ReactNode;
  current?: boolean;
  disabled?: boolean;
  status?: {
    label: string;
    tone: 'danger' | 'muted' | 'warning';
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
}: SwitcherDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const listId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | undefined>(() => initialActiveId(items));
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

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!filteredItems.length) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive((Math.max(activeIndex, -1) + 1) % filteredItems.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive((activeIndex <= 0 ? filteredItems.length : activeIndex) - 1);
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
        if (!active || active.disabled) return;
        event.preventDefault();
        onSelect(active);
        break;
      }
    }
  };

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
        <input
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-activedescendant={activeOptionId}
          aria-describedby={hint ? hintId : undefined}
          autoComplete="off"
          data-dialog-initial-focus
          placeholder={title}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            const nextItems = matchingItems(items, nextQuery);
            setQuery(nextQuery);
            setActiveId(initialActiveId(nextItems));
          }}
          onKeyDown={handleSearchKeyDown}
        />
      </label>
      {hint ? (
        <p id={hintId} className="switcher-hint">
          {hint}
        </p>
      ) : null}
      <div id={listId} className="switcher-list" role="listbox" aria-label={title}>
        {loading ? (
          <output className="switcher-empty">{t('loading')}</output>
        ) : filteredItems.length ? (
          filteredItems.map((item, index) => {
            const selected = item.id === effectiveActiveId;
            return (
              <button
                key={item.id}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-current={item.current ? 'true' : undefined}
                aria-disabled={item.disabled || undefined}
                className="switcher-option"
                onMouseEnter={() => setActiveId(item.id)}
                onClick={() => {
                  if (!item.disabled) onSelect(item);
                }}
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
              </button>
            );
          })
        ) : (
          <p className="switcher-empty">{emptyMessage}</p>
        )}
      </div>
      {footer ? <div className="switcher-footer">{footer}</div> : null}
    </Dialog>
  );
}
