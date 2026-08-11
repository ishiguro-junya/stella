/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- native drop targetにはkeyboard操作用の同等なcheckboxがある。 */
import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
const DRAG_MIME = 'application/x-stella-change';

type StageableArea = 'staged' | 'unstaged' | 'untracked';
type DropArea = 'staged' | 'unstaged';
type DisplayGroup = 'conflicted' | 'staged' | 'worktree' | 'combined';
type StageGroup = Exclude<DisplayGroup, 'conflicted'>;

interface ChangeGroup {
  id: DisplayGroup;
  label: string;
  targetArea?: ChangeArea;
  entries: ChangeEntry[];
  splitStageView?: boolean | undefined;
}

export interface StageTransitionRequest {
  kind: 'stage' | 'unstage';
  paths: string[];
  sourceArea: StageableArea;
}

interface ActiveDrag {
  token: string;
  repoId: RepoId;
  generation: number;
  key: string;
  path: string;
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
  disabled: boolean;
  disabledReasonId?: string | undefined;
  fileActionsDisabled: boolean;
  fileOpenDisabled: boolean;
  fileTrashDisabled: boolean;
  onSelect: (key: string) => void;
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

function canDrop(sourceArea: StageableArea, targetArea: ChangeArea): targetArea is DropArea {
  return (
    (targetArea === 'staged' && sourceArea !== 'staged') ||
    (targetArea === 'unstaged' && sourceArea === 'staged')
  );
}

function makeDragToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `stella-drag-${Date.now().toString(36)}`;
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
  disabled,
  disabledReasonId,
  fileActionsDisabled,
  fileOpenDisabled,
  fileTrashDisabled,
  onSelect,
  onStageTransition,
  onFileAction,
}: ChangeListProps) {
  const { t } = useI18n();
  const [transferPending, setTransferPending] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string>();
  const [dropTarget, setDropTarget] = useState<DropArea>();
  const [dragAnnouncement, setDragAnnouncement] = useState('');
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [contextMenu, setContextMenu] = useState<
    { key: string; point: FileActionMenuPoint } | undefined
  >();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(selectedKey ? [selectedKey] : []),
  );
  const activeDragRef = useRef<ActiveDrag | undefined>(undefined);
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

  const conflictGroup: ChangeGroup = {
    id: 'conflicted',
    label: t(AREA_LABELS.conflicted),
    targetArea: 'conflicted',
    entries: entries.filter((entry) => entry.area === 'conflicted'),
  };
  const splitGroups: ChangeGroup[] = [
    conflictGroup,
    {
      id: 'staged',
      label: t(AREA_LABELS.staged),
      targetArea: 'staged',
      entries: entries.filter((entry) => entry.area === 'staged'),
    },
    {
      id: 'worktree',
      label: t(AREA_LABELS.unstaged),
      targetArea: 'unstaged',
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
    if (event.shiftKey) {
      const anchor = selectionAnchorRef.current ?? (selectedKey || key);
      const anchorIndex = orderedEntryKeys.indexOf(anchor);
      const targetIndex = orderedEntryKeys.indexOf(key);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] =
          anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const range = orderedEntryKeys.slice(start, end + 1);
        setSelectedKeys((current) => new Set(commandSelection ? [...current, ...range] : range));
      }
    } else if (commandSelection) {
      setSelectedKeys((current) => {
        const next = new Set(current);
        if (next.has(key) && next.size > 1) next.delete(key);
        else next.add(key);
        return next;
      });
      selectionAnchorRef.current = key;
    } else {
      setSelectedKeys(new Set([key]));
      selectionAnchorRef.current = key;
    }
    onSelect(key);
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, key: string): void => {
    event.preventDefault();
    event.currentTarget.focus();
    if (!selectedKeys.has(key)) {
      setSelectedKeys(new Set([key]));
      selectionAnchorRef.current = key;
    }
    onSelect(key);
    setContextMenu({ key, point: { x: event.clientX, y: event.clientY } });
    setOpenMenuKey(key);
  };

  const selectAllFiles = (event: ReactKeyboardEvent<HTMLFieldSetElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    setSelectedKeys(new Set(orderedEntryKeys));
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
    setSelectedKeys(new Set([nextKey]));
    selectionAnchorRef.current = nextKey;
    onSelect(nextKey);
    rowRefs.current.get(nextKey)?.focus();
  };

  const clearDrag = (): void => {
    activeDragRef.current = undefined;
    setDraggingKey(undefined);
    setDropTarget(undefined);
  };

  useEffect(() => {
    activeDragRef.current = undefined;
    setDraggingKey(undefined);
    setDropTarget(undefined);
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

  const activeInternalDrag = (event: ReactDragEvent): ActiveDrag | undefined => {
    if (interactionsDisabled) return undefined;
    const active = activeDragRef.current;
    if (
      !active ||
      !event.dataTransfer.types.includes(DRAG_MIME) ||
      active.repoId !== repoId ||
      active.generation !== generation ||
      !entries.some((entry) => entryKey(entry) === active.key)
    )
      return undefined;
    return active;
  };

  const currentDrop = (event: ReactDragEvent): ActiveDrag | undefined => {
    const active = activeInternalDrag(event);
    if (!active || event.dataTransfer.getData(DRAG_MIME) !== active.token) return undefined;
    return active;
  };

  const beginDrag = (event: ReactDragEvent<HTMLButtonElement>, entry: ChangeEntry): void => {
    if (interactionsDisabled || !isStageableArea(entry.area)) {
      event.preventDefault();
      return;
    }
    const token = makeDragToken();
    const active: ActiveDrag = {
      token,
      repoId,
      generation,
      key: entryKey(entry),
      path: entry.path,
      sourceArea: entry.area,
    };
    activeDragRef.current = active;
    event.dataTransfer.clearData();
    event.dataTransfer.setData(DRAG_MIME, token);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingKey(active.key);
    const destination = t(active.sourceArea === 'staged' ? 'unstaged' : 'staged');
    setDragAnnouncement(t('changeDragAnnouncement', { path: entry.path, destination }));
  };

  const dragOverGroup = (event: ReactDragEvent<HTMLElement>, area: ChangeArea): void => {
    const active = activeInternalDrag(event);
    if (!active || !canDrop(active.sourceArea, area)) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(area);
  };

  const leaveGroup = (event: ReactDragEvent<HTMLElement>, area: ChangeArea): void => {
    if (dropTarget !== area) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget(undefined);
  };

  const dropOnGroup = (event: ReactDragEvent<HTMLElement>, area: ChangeArea): void => {
    const active = currentDrop(event);
    if (!active || !canDrop(active.sourceArea, area)) {
      clearDrag();
      return;
    }
    event.preventDefault();
    const kind = transitionForArea(active.sourceArea);
    clearDrag();
    setDragAnnouncement('');
    settleTransition(
      runTransition(
        { kind, paths: [active.path], sourceArea: active.sourceArea },
        { path: active.path, target: targetForTransition(kind) },
      ),
    );
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
      className={`change-groups${splitStageView ? '' : ' is-stage-combined'}`}
      onKeyDown={selectAllFiles}
    >
      <legend className="sr-only">{t('changes')}</legend>
      <p id="changes-drag-help" className="sr-only">
        {t('changeDragHelp')}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {dragAnnouncement}
      </p>
      {groups.map(({ id, label, targetArea, entries: groupEntries }) => {
        const stageGroup = id === 'conflicted' ? undefined : id;
        const active = activeDragRef.current;
        const compatibleDrop = Boolean(
          targetArea && active && canDrop(active.sourceArea, targetArea),
        );
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
        const isDropTarget = targetArea !== undefined && dropTarget === targetArea;
        const title = compatibleDrop
          ? targetArea === 'staged'
            ? t('dropToStage')
            : t('dropToUnstage')
          : label;
        const titleId = `area-${id}`;

        return (
          <section
            key={id}
            className={`change-group change-group-${id}${compatibleDrop ? ' can-drop' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
            aria-labelledby={titleId}
            onDragOver={(event) => {
              if (targetArea) dragOverGroup(event, targetArea);
            }}
            onDragLeave={(event) => {
              if (targetArea) leaveGroup(event, targetArea);
            }}
            onDrop={(event) => {
              if (targetArea) dropOnGroup(event, targetArea);
            }}
          >
            <div className="change-group-header">
              {stageGroup ? (
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
              ) : (
                <span className="change-group-header-spacer" aria-hidden="true" />
              )}
              <h3 id={titleId}>
                <span
                  ref={(element) => {
                    if (element) groupFocusRefs.current.set(id, element);
                    else groupFocusRefs.current.delete(id);
                  }}
                  className="change-group-title"
                  tabIndex={-1}
                >
                  {title}
                </span>
                <span className="change-count" aria-hidden="true">
                  {groupEntries.length}
                </span>
              </h3>
            </div>
            <div className="change-group-content">
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
                        className={`change-item${selectedKeys.has(key) ? ' is-selected' : ''}${selectedKey === key ? ' is-current' : ''}${draggingKey === key ? ' is-dragging' : ''}`}
                      >
                        {entryStageableArea ? (
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
                        ) : (
                          <span className="change-row-spacer" aria-hidden="true" />
                        )}
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
                          aria-describedby={entryStageableArea ? 'changes-drag-help' : undefined}
                          draggable={entryStageableArea && !interactionsDisabled ? true : undefined}
                          onClick={(event) => {
                            event.currentTarget.focus();
                            selectFile(event, key);
                          }}
                          onContextMenu={(event) => openContextMenu(event, key)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowUp') moveFileSelection(event, key, -1);
                            else if (event.key === 'ArrowDown') moveFileSelection(event, key, 1);
                          }}
                          onDragStart={(event) => beginDrag(event, entry)}
                          onDragEnd={() => {
                            clearDrag();
                            setDragAnnouncement('');
                          }}
                        >
                          <FileStatusIcon status={entry.status} />
                          <span className="file-path">
                            <strong>{fileName(entry.path)}</strong>
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
                              setSelectedKeys(new Set([key]));
                              selectionAnchorRef.current = key;
                              onSelect(key);
                            }
                          }}
                          onAction={(fileAction) => runFileAction(selectedEntries, fileAction)}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : compatibleDrop ? (
                <p className="change-drop-placeholder">
                  {t(targetArea === 'staged' ? 'dropHereToStage' : 'dropHereToUnstage')}
                </p>
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
