/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- change listのfieldsetでCommand-Aによる全file選択を処理する。 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChangeArea, ChangeEntry, RepoId } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { FileStatusIcon } from '../../ui/FileStatusIcon';
import { FileActionMenu, type FileActionKind, type FileActionMenuPoint } from './FileActionMenu';

const AREA_LABELS: Record<ChangeArea, MessageKey> = {
  conflicted: 'conflicted',
  staged: 'staged',
  unstaged: 'unstaged',
  untracked: 'untracked',
};

const STATUS_LABELS: Record<ChangeEntry['status'], MessageKey> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  binary: 'binary',
  conflicted: 'conflicted',
};
type StageableArea = 'staged' | 'unstaged' | 'untracked';
type DisplayGroup = 'conflicted' | 'staged' | 'worktree' | 'combined';
type StageGroup = Exclude<DisplayGroup, 'conflicted'>;
type CollapsibleGroup = Extract<DisplayGroup, 'staged' | 'worktree'>;

interface ChangeGroup {
  id: DisplayGroup;
  label: string;
  entries: ChangeEntry[];
}

export interface StageTransitionRequest {
  kind: 'stage' | 'unstage';
  paths: string[];
  sourceArea: StageableArea;
}

interface PendingFocus {
  path?: string;
  target: 'staged' | 'worktree';
}

interface PendingTrashFocus {
  generation: number;
  key: string;
  path: string;
  sourceArea: ChangeArea;
  orderedKeys: string[];
}

export interface ChangeListProps {
  repoId: RepoId;
  generation: number;
  entries: ChangeEntry[];
  splitStageView?: boolean | undefined;
  selectedKey: string;
  selectionKeys?: readonly string[] | undefined;
  unsavedFileKey?: string | undefined;
  disabled: boolean;
  disabledReasonId?: string | undefined;
  fileActionsDisabled: boolean;
  fileEditDisabled?: boolean | undefined;
  fileOpenDisabled: boolean;
  fileTrashDisabled: boolean;
  onSelect: (key: string) => void;
  onSelectedKeysChange?: ((keys: string[]) => void) | undefined;
  onStageTransition: (request: StageTransitionRequest) => Promise<void>;
  onFileAction: (entries: ChangeEntry[], action: FileActionKind) => Promise<void>;
}

function entryKey(entry: ChangeEntry): string {
  return `${entry.area}:${entry.path}`;
}

function isStageableArea(area: ChangeArea): area is StageableArea {
  return area !== 'conflicted';
}

function transitionForArea(area: StageableArea): 'stage' | 'unstage' {
  return area === 'staged' ? 'unstage' : 'stage';
}

function transitionLabel(area: StageableArea): MessageKey {
  return area === 'staged' ? 'unstage' : 'stage';
}

function targetForTransition(kind: 'stage' | 'unstage'): PendingFocus['target'] {
  return kind === 'stage' ? 'staged' : 'worktree';
}

function displayGroupForArea(area: ChangeArea, splitStageView: boolean): DisplayGroup {
  if (area === 'conflicted') return 'conflicted';
  if (!splitStageView) return 'combined';
  return area === 'staged' ? 'staged' : 'worktree';
}

function settleTransition(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export function ChangeList({
  repoId,
  generation,
  entries,
  splitStageView = true,
  selectedKey,
  selectionKeys,
  unsavedFileKey,
  disabled,
  disabledReasonId,
  fileActionsDisabled,
  fileEditDisabled = false,
  fileOpenDisabled,
  fileTrashDisabled,
  onSelect,
  onSelectedKeysChange,
  onStageTransition,
  onFileAction,
}: ChangeListProps) {
  const { t } = useI18n();
  const [transferPending, setTransferPending] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [contextMenu, setContextMenu] = useState<
    { key: string; point: FileActionMenuPoint } | undefined
  >();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CollapsibleGroup>>(() => new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(selectedKey ? [selectedKey] : []),
  );
  const selectionAnchorRef = useRef<string | undefined>(selectedKey || undefined);
  const pendingFocusRef = useRef<PendingFocus | undefined>(undefined);
  const pendingTrashFocusRef = useRef<PendingTrashFocus | undefined>(undefined);
  const selectionRepoRef = useRef(repoId);
  const focusExpiryRef = useRef<number | undefined>(undefined);
  const checkboxRefs = useRef(new Map<string, HTMLInputElement>());
  const groupCheckboxRefs = useRef(new Map<StageGroup, HTMLInputElement>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const groupFocusRefs = useRef(new Map<DisplayGroup, HTMLElement>());
  const interactionsDisabled = disabled || transferPending;
  const controlledSelectionSignature = selectionKeys?.join('\0');

  const updateSelectedKeys = (next: Set<string>): void => {
    if (!selectionKeys) setSelectedKeys(next);
    onSelectedKeysChange?.([...next]);
  };

  useEffect(() => {
    if (!selectionKeys) return;
    setSelectedKeys(new Set(selectionKeys));
  }, [controlledSelectionSignature, selectionKeys]);

  const conflictGroup: ChangeGroup = {
    id: 'conflicted',
    label: t(AREA_LABELS.conflicted),
    entries: entries.filter((entry) => entry.area === 'conflicted'),
  };
  const splitGroups: ChangeGroup[] = [
    conflictGroup,
    {
      id: 'staged',
      label: t(AREA_LABELS.staged),
      entries: entries.filter((entry) => entry.area === 'staged'),
    },
    {
      id: 'worktree',
      label: t(AREA_LABELS.unstaged),
      entries: entries.filter((entry) => entry.area === 'unstaged' || entry.area === 'untracked'),
    },
  ];
  const groups: ChangeGroup[] = splitStageView
    ? splitGroups
    : [
        conflictGroup,
        {
          id: 'combined',
          label: t('changes'),
          entries: entries.filter((entry) => entry.area !== 'conflicted'),
        },
      ];
  const orderedEntryKeys = groups.flatMap((group) => group.entries.map(entryKey));

  const selectFile = (event: ReactMouseEvent<HTMLButtonElement>, key: string): void => {
    const commandSelection = event.metaKey || event.ctrlKey;
    let nextSelection: Set<string> | undefined;
    if (event.shiftKey) {
      const anchor = selectionAnchorRef.current ?? (selectedKey || key);
      const anchorIndex = orderedEntryKeys.indexOf(anchor);
      const targetIndex = orderedEntryKeys.indexOf(key);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] =
          anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const range = orderedEntryKeys.slice(start, end + 1);
        nextSelection = new Set(commandSelection ? [...selectedKeys, ...range] : range);
        updateSelectedKeys(nextSelection);
      }
    } else if (commandSelection) {
      const next = new Set(selectedKeys);
      if (next.has(key) && next.size > 1) next.delete(key);
      else next.add(key);
      nextSelection = next;
      updateSelectedKeys(next);
      selectionAnchorRef.current = key;
    } else {
      nextSelection = new Set([key]);
      updateSelectedKeys(nextSelection);
      selectionAnchorRef.current = key;
    }
    const activeKey = nextSelection && !nextSelection.has(key) ? [...nextSelection].at(-1) : key;
    if (activeKey) onSelect(activeKey);
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, key: string): void => {
    event.preventDefault();
    event.currentTarget.focus();
    if (!selectedKeys.has(key)) {
      updateSelectedKeys(new Set([key]));
      selectionAnchorRef.current = key;
    }
    onSelect(key);
    setContextMenu({ key, point: { x: event.clientX, y: event.clientY } });
    setOpenMenuKey(key);
  };

  const selectAllFiles = (event: ReactKeyboardEvent<HTMLFieldSetElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    updateSelectedKeys(new Set(orderedEntryKeys));
    const anchor = selectedKey || orderedEntryKeys[0];
    selectionAnchorRef.current = anchor;
    if (!selectedKey && anchor) onSelect(anchor);
  };
  const moveFileSelection = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    key: string,
    offset: -1 | 1,
  ): void => {
    const groupEntryKeys = groups
      .find((group) => group.entries.some((entry) => entryKey(entry) === key))
      ?.entries.map(entryKey);
    if (!groupEntryKeys) return;
    const currentIndex = groupEntryKeys.indexOf(key);
    if (currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), groupEntryKeys.length - 1);
    const nextKey = groupEntryKeys[nextIndex];
    if (!nextKey || nextKey === key) return;
    updateSelectedKeys(new Set([nextKey]));
    selectionAnchorRef.current = nextKey;
    onSelect(nextKey);
    rowRefs.current.get(nextKey)?.focus();
  };

  useEffect(() => {
    setOpenMenuKey(undefined);
    setContextMenu(undefined);
  }, [generation, repoId]);

  useEffect(() => {
    if (selectionRepoRef.current === repoId) return;
    selectionRepoRef.current = repoId;
    pendingTrashFocusRef.current = undefined;
    const initial = selectedKey ? new Set([selectedKey]) : new Set<string>();
    setSelectedKeys(initial);
    selectionAnchorRef.current = selectedKey || undefined;
    setCollapsedGroups(new Set());
  }, [repoId, selectedKey]);

  useEffect(() => {
    const available = new Set(entries.map(entryKey));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      if (selectedKey && available.has(selectedKey)) next.add(selectedKey);
      return next;
    });
    if (selectionAnchorRef.current && !available.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current =
        selectedKey && available.has(selectedKey) ? selectedKey : undefined;
    }
  }, [entries, selectedKey]);

  useEffect(() => {
    if (fileActionsDisabled) setOpenMenuKey(undefined);
  }, [fileActionsDisabled]);

  useEffect(
    () => () => {
      if (focusExpiryRef.current !== undefined) window.clearTimeout(focusExpiryRef.current);
    },
    [],
  );

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || interactionsDisabled) return;

    let target: HTMLInputElement | undefined;
    if (pending.path) {
      const nextEntry = entries.find(
        (entry) =>
          entry.path === pending.path &&
          (pending.target === 'staged'
            ? entry.area === 'staged'
            : entry.area === 'unstaged' || entry.area === 'untracked'),
      );
      if (nextEntry) {
        const nextGroup = displayGroupForArea(nextEntry.area, splitStageView);
        target =
          checkboxRefs.current.get(entryKey(nextEntry)) ??
          (nextGroup === 'conflicted' ? undefined : groupCheckboxRefs.current.get(nextGroup));
      }
    } else if (pending.target === 'staged') {
      target = groupCheckboxRefs.current.get(splitStageView ? 'staged' : 'combined');
    } else {
      target = groupCheckboxRefs.current.get(splitStageView ? 'worktree' : 'combined');
    }

    if (!target || target.disabled) return;
    target.focus();
    pendingFocusRef.current = undefined;
    if (focusExpiryRef.current !== undefined) window.clearTimeout(focusExpiryRef.current);
    focusExpiryRef.current = undefined;
  }, [entries, interactionsDisabled, splitStageView]);

  useEffect(() => {
    const pending = pendingTrashFocusRef.current;
    if (!pending || generation === pending.generation) return;
    const active = document.activeElement;
    const focusNeedsRecovery =
      !(active instanceof HTMLElement) || active === document.body || !active.isConnected;

    const focusEntry = (entry: ChangeEntry): void => {
      (
        rowRefs.current.get(entryKey(entry)) ??
        groupFocusRefs.current.get(displayGroupForArea(entry.area, splitStageView))
      )?.focus();
    };

    const samePath = entries.find((entry) => entry.path === pending.path);
    if (samePath) {
      if (focusNeedsRecovery) focusEntry(samePath);
      pendingTrashFocusRef.current = undefined;
      return;
    }

    const currentKeys = new Set(entries.map(entryKey));
    const oldIndex = pending.orderedKeys.indexOf(pending.key);
    const nextKey = pending.orderedKeys
      .slice(oldIndex + 1)
      .find((candidate) => currentKeys.has(candidate));
    const previousKey = pending.orderedKeys
      .slice(0, Math.max(0, oldIndex))
      .toReversed()
      .find((candidate) => currentKeys.has(candidate));
    const nextRow = nextKey ?? previousKey;
    if (!focusNeedsRecovery) {
      pendingTrashFocusRef.current = undefined;
      return;
    }
    if (nextRow) {
      const nextEntry = entries.find((entry) => entryKey(entry) === nextRow);
      if (nextEntry) focusEntry(nextEntry);
    } else {
      const sourceHeading = groupFocusRefs.current.get(
        displayGroupForArea(pending.sourceArea, splitStageView),
      );
      const fallbackHeading = groupFocusRefs.current.values().next().value;
      (sourceHeading ?? fallbackHeading)?.focus();
    }
    pendingTrashFocusRef.current = undefined;
  }, [entries, generation, splitStageView]);

  const runTransition = async (
    request: StageTransitionRequest,
    focus: PendingFocus,
  ): Promise<void> => {
    if (interactionsDisabled) return;
    if (splitStageView) {
      const targetGroup: CollapsibleGroup = focus.target === 'staged' ? 'staged' : 'worktree';
      setCollapsedGroups((current) => {
        if (!current.has(targetGroup)) return current;
        const next = new Set(current);
        next.delete(targetGroup);
        return next;
      });
    }
    const available = new Set(
      entries
        .filter(
          (entry) => isStageableArea(entry.area) && transitionForArea(entry.area) === request.kind,
        )
        .map((entry) => entry.path),
    );
    const paths = [...new Set(request.paths)].filter((path) => available.has(path));
    if (!paths.length) return;

    pendingFocusRef.current = focus;
    if (focusExpiryRef.current !== undefined) window.clearTimeout(focusExpiryRef.current);
    focusExpiryRef.current = window.setTimeout(() => {
      pendingFocusRef.current = undefined;
      focusExpiryRef.current = undefined;
    }, 5_000);
    setTransferPending(true);
    try {
      await onStageTransition({ ...request, paths });
    } catch (cause) {
      pendingFocusRef.current = undefined;
      if (focusExpiryRef.current !== undefined) window.clearTimeout(focusExpiryRef.current);
      focusExpiryRef.current = undefined;
      throw cause;
    } finally {
      setTransferPending(false);
    }
  };

  const runFileAction = async (
    selectedEntries: ChangeEntry[],
    action: FileActionKind,
  ): Promise<void> => {
    const entry = selectedEntries[0];
    if (!entry) return;
    if (action === 'moveToTrash') {
      pendingTrashFocusRef.current = {
        generation,
        key: entryKey(entry),
        path: entry.path,
        sourceArea: entry.area,
        orderedKeys: groups.flatMap((group) => group.entries.map(entryKey)),
      };
    }
    try {
      await onFileAction(selectedEntries, action);
    } catch (cause) {
      if (action === 'moveToTrash') pendingTrashFocusRef.current = undefined;
      throw cause;
    }
  };

  return (
    <fieldset
      className={`change-groups${splitStageView ? '' : ' is-stage-hidden'}${splitStageView && collapsedGroups.has('staged') ? ' is-staged-collapsed' : ''}${splitStageView && collapsedGroups.has('worktree') ? ' is-worktree-collapsed' : ''}`}
      onKeyDown={selectAllFiles}
    >
      <legend className="sr-only">{t('changes')}</legend>
      {groups.map(({ id, label, entries: groupEntries }) => {
        const stageGroup = id === 'conflicted' ? undefined : id;
        if (id === 'conflicted' && !groupEntries.length) return null;
        const selectedGroupEntry = groupEntries.find((entry) => entryKey(entry) === selectedKey);
        const allStaged =
          groupEntries.length > 0 && groupEntries.every((entry) => entry.area === 'staged');
        const combinedSourceEntry = groupEntries.find((entry) => entry.area !== 'staged');
        const sourceArea =
          stageGroup === 'staged' || (stageGroup === 'combined' && allStaged)
            ? 'staged'
            : stageGroup === 'combined' &&
                combinedSourceEntry &&
                isStageableArea(combinedSourceEntry.area)
              ? combinedSourceEntry.area
              : selectedGroupEntry && isStageableArea(selectedGroupEntry.area)
                ? selectedGroupEntry.area
                : groupEntries.some((entry) => entry.area === 'unstaged')
                  ? 'unstaged'
                  : 'untracked';
        const action = stageGroup ? transitionForArea(sourceArea) : undefined;
        const actionLabel = stageGroup ? t(transitionLabel(sourceArea)) : undefined;
        const actionableGroupEntries = action
          ? groupEntries.filter(
              (entry) => isStageableArea(entry.area) && transitionForArea(entry.area) === action,
            )
          : [];
        const titleId = `area-${id}`;
        const contentId = `${titleId}-content`;
        const collapsibleGroup: CollapsibleGroup | undefined =
          id === 'staged' || id === 'worktree' ? id : undefined;
        const groupCollapsed = Boolean(collapsibleGroup && collapsedGroups.has(collapsibleGroup));

        return (
          <section
            key={id}
            className={`change-group change-group-${id}${groupCollapsed ? ' is-collapsed' : ''}`}
            aria-labelledby={titleId}
          >
            <div className={`change-group-header${collapsibleGroup ? ' is-collapsible' : ''}`}>
              {stageGroup && splitStageView ? (
                <label className="stage-toggle-hitbox">
                  <input
                    ref={(element) => {
                      if (element) {
                        groupCheckboxRefs.current.set(stageGroup, element);
                        element.indeterminate =
                          stageGroup === 'combined' &&
                          groupEntries.some((entry) => entry.area === 'staged') &&
                          !allStaged;
                      } else groupCheckboxRefs.current.delete(stageGroup);
                    }}
                    className="stage-toggle"
                    type="checkbox"
                    checked={groupEntries.length > 0 && (stageGroup === 'staged' || allStaged)}
                    disabled={interactionsDisabled || !actionableGroupEntries.length}
                    aria-label={t('changeAllAria', {
                      action: actionLabel ?? '',
                      count: actionableGroupEntries.length,
                      area: label,
                    })}
                    aria-describedby={disabledReasonId}
                    onChange={() => {
                      if (!action) return;
                      settleTransition(
                        runTransition(
                          {
                            kind: action,
                            paths: actionableGroupEntries.map((entry) => entry.path),
                            sourceArea,
                          },
                          { target: targetForTransition(action) },
                        ),
                      );
                    }}
                  />
                </label>
              ) : splitStageView ? (
                <span className="change-group-header-spacer" aria-hidden="true" />
              ) : null}
              <h3 id={titleId}>
                <span
                  ref={(element) => {
                    if (element) groupFocusRefs.current.set(id, element);
                    else groupFocusRefs.current.delete(id);
                  }}
                  className="change-group-title"
                  tabIndex={-1}
                >
                  {label}
                </span>
                <span className="change-count" aria-hidden="true">
                  {groupEntries.length}
                </span>
              </h3>
              {collapsibleGroup ? (
                <button
                  className="change-group-collapse-toggle"
                  type="button"
                  aria-expanded={!groupCollapsed}
                  aria-controls={contentId}
                  aria-label={t(groupCollapsed ? 'expandChangeGroup' : 'collapseChangeGroup', {
                    area: label,
                  })}
                  onClick={() => {
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(collapsibleGroup)) next.delete(collapsibleGroup);
                      else next.add(collapsibleGroup);
                      return next;
                    });
                  }}
                >
                  {groupCollapsed ? (
                    <ChevronRight aria-hidden="true" focusable="false" />
                  ) : (
                    <ChevronDown aria-hidden="true" focusable="false" />
                  )}
                </button>
              ) : null}
            </div>
            <div id={contentId} className="change-group-content" hidden={groupCollapsed}>
              {groupEntries.length ? (
                <ul className="change-list">
                  {groupEntries.map((entry) => {
                    const key = entryKey(entry);
                    const entryStageableArea = isStageableArea(entry.area) ? entry.area : undefined;
                    const entryAction = entryStageableArea
                      ? transitionForArea(entryStageableArea)
                      : undefined;
                    const entryActionLabel = entryStageableArea
                      ? t(transitionLabel(entryStageableArea))
                      : undefined;
                    const selectedEntries = selectedKeys.has(key)
                      ? entries.filter((candidate) => selectedKeys.has(entryKey(candidate)))
                      : [entry];
                    const selectedPaths = [
                      ...new Set(selectedEntries.map((candidate) => candidate.path)),
                    ];
                    const invalidFileActionEntry = selectedEntries.some(
                      (candidate) =>
                        candidate.area === 'conflicted' || candidate.status === 'deleted',
                    );
                    const discardDisabled =
                      fileTrashDisabled ||
                      selectedEntries.some(
                        (candidate) =>
                          candidate.area !== 'unstaged' || candidate.status === 'deleted',
                      );
                    return (
                      <li
                        key={key}
                        className={`change-item${selectedKeys.has(key) ? ' is-selected' : ''}${selectedKey === key ? ' is-current' : ''}`}
                      >
                        {entryStageableArea && splitStageView ? (
                          <label className="stage-toggle-hitbox">
                            <input
                              ref={(element) => {
                                if (element) checkboxRefs.current.set(key, element);
                                else checkboxRefs.current.delete(key);
                              }}
                              className="stage-toggle"
                              type="checkbox"
                              checked={entry.area === 'staged'}
                              disabled={interactionsDisabled}
                              aria-label={`${entryActionLabel} ${entry.path}`}
                              aria-describedby={disabledReasonId}
                              onChange={() => {
                                if (!entryAction) return;
                                settleTransition(
                                  runTransition(
                                    {
                                      kind: entryAction,
                                      paths: [entry.path],
                                      sourceArea: entryStageableArea,
                                    },
                                    {
                                      path: entry.path,
                                      target: targetForTransition(entryAction),
                                    },
                                  ),
                                );
                              }}
                            />
                          </label>
                        ) : splitStageView ? (
                          <span className="change-row-spacer" aria-hidden="true" />
                        ) : null}
                        <button
                          ref={(element) => {
                            if (element) rowRefs.current.set(key, element);
                            else rowRefs.current.delete(key);
                          }}
                          type="button"
                          className="change-row"
                          aria-label={t('changeStatusAria', {
                            status: t(STATUS_LABELS[entry.status]),
                            path: entry.path,
                          })}
                          aria-current={selectedKey === key ? 'true' : undefined}
                          aria-pressed={selectedKeys.has(key)}
                          onClick={(event) => {
                            event.currentTarget.focus();
                            selectFile(event, key);
                          }}
                          onContextMenu={(event) => openContextMenu(event, key)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowUp') moveFileSelection(event, key, -1);
                            else if (event.key === 'ArrowDown') moveFileSelection(event, key, 1);
                          }}
                        >
                          <FileStatusIcon status={entry.status} />
                          <span className="file-path">
                            <span className="file-name">
                              <strong>{fileName(entry.path)}</strong>
                              {unsavedFileKey === key ? (
                                <output className="unsaved-file-dot" aria-label={t('unsaved')} />
                              ) : null}
                            </span>
                            <small>{parentPath(entry.path)}</small>
                          </span>
                          {entry.additions !== undefined || entry.deletions !== undefined ? (
                            <span className="diff-stat">
                              <i>+{entry.additions ?? 0}</i>
                              <b>−{entry.deletions ?? 0}</b>
                            </span>
                          ) : null}
                        </button>
                        <FileActionMenu
                          path={entry.path}
                          selectedPaths={selectedPaths}
                          open={openMenuKey === key}
                          disabled={fileActionsDisabled}
                          editDisabled={fileEditDisabled || invalidFileActionEntry}
                          openDisabled={
                            fileOpenDisabled || selectedPaths.length !== 1 || invalidFileActionEntry
                          }
                          discardDisabled={discardDisabled}
                          deleteDisabled={fileTrashDisabled || invalidFileActionEntry}
                          contextPoint={contextMenu?.key === key ? contextMenu.point : undefined}
                          onOpenChange={(open) => {
                            setOpenMenuKey(open ? key : undefined);
                            if (!open) setContextMenu(undefined);
                          }}
                          onTriggerOpen={() => {
                            setContextMenu(undefined);
                            if (!selectedKeys.has(key)) {
                              updateSelectedKeys(new Set([key]));
                              selectionAnchorRef.current = key;
                              onSelect(key);
                            }
                          }}
                          onAction={(fileAction) =>
                            runFileAction(
                              fileAction === 'editFile' ? [entry] : selectedEntries,
                              fileAction,
                            )
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </section>
        );
      })}
    </fieldset>
  );
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function parentPath(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}
