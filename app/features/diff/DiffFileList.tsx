/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- 差分一覧のフィールドセットでCommand-Aによる全ファイル選択を処理する。 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import type { ChangeArea, ChangeEntry, RepoId } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import type { DiffFileListDisplay } from '../../persistence/preferences';
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

interface ChangeTreeDirectory {
  name: string;
  path: string;
  directories: Map<string, ChangeTreeDirectory>;
  entries: ChangeEntry[];
}

type DiffFileListRow =
  | { kind: 'directory'; name: string; path: string; depth: number }
  | { kind: 'file'; entry: ChangeEntry; depth: number };

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

export interface DiffFileListProps {
  repoId: RepoId;
  generation: number;
  entries: ChangeEntry[];
  splitStageView?: boolean | undefined;
  display?: DiffFileListDisplay | undefined;
  selectedKey: string;
  selectionKeys?: readonly string[] | undefined;
  unsavedFileKey?: string | undefined;
  editingFileKey?: string | undefined;
  disabled: boolean;
  disabledReasonId?: string | undefined;
  fileActionsDisabled: boolean;
  fileEditDisabled?: boolean | undefined;
  fileRenameDisabled?: boolean | undefined;
  fileOpenDisabled: boolean;
  fileTrashDisabled: boolean;
  imagePreview?:
    | ((entry: ChangeEntry) =>
        | {
            pressed: boolean;
            disabled?: boolean | undefined;
            onPressedChange: (pressed: boolean) => void;
          }
        | undefined)
    | undefined;
  onSelect: (key: string) => void;
  onSelectedKeysChange?: ((keys: string[]) => void) | undefined;
  onStageTransition: (request: StageTransitionRequest) => Promise<void>;
  onFileAction: (entries: ChangeEntry[], action: FileActionKind) => Promise<void>;
  renamingKey?: string | undefined;
  renamePending?: boolean | undefined;
  onRenameStart?: ((entry: ChangeEntry) => void) | undefined;
  onRenameCancel?: (() => void) | undefined;
  onRename?: ((entry: ChangeEntry, name: string) => Promise<void>) | undefined;
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

function directoryKey(group: DisplayGroup, path: string): string {
  return `${group}:${path}`;
}

function changeListRows(
  entries: ChangeEntry[],
  group: DisplayGroup,
  display: DiffFileListDisplay,
  collapsedDirectories: ReadonlySet<string>,
): DiffFileListRow[] {
  if (display !== 'tree') return entries.map((entry) => ({ kind: 'file', entry, depth: 0 }));

  const root: ChangeTreeDirectory = {
    name: '',
    path: '',
    directories: new Map(),
    entries: [],
  };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let directory = root;
    let path = '';
    for (const name of parts.slice(0, -1)) {
      path = path ? `${path}/${name}` : name;
      let child = directory.directories.get(name);
      if (!child) {
        child = { name, path, directories: new Map(), entries: [] };
        directory.directories.set(name, child);
      }
      directory = child;
    }
    directory.entries.push(entry);
  }

  const rows: DiffFileListRow[] = [];
  const append = (directory: ChangeTreeDirectory, depth: number): void => {
    for (const child of directory.directories.values()) {
      rows.push({ kind: 'directory', name: child.name, path: child.path, depth });
      if (!collapsedDirectories.has(directoryKey(group, child.path))) append(child, depth + 1);
    }
    for (const entry of directory.entries) rows.push({ kind: 'file', entry, depth });
  };
  append(root, 0);
  return rows;
}

export function DiffFileList({
  repoId,
  generation,
  entries,
  splitStageView = true,
  display = 'nameAndPath',
  selectedKey,
  selectionKeys,
  unsavedFileKey,
  editingFileKey,
  disabled,
  disabledReasonId,
  fileActionsDisabled,
  fileEditDisabled = false,
  fileRenameDisabled = false,
  fileOpenDisabled,
  fileTrashDisabled,
  imagePreview,
  onSelect,
  onSelectedKeysChange,
  onStageTransition,
  onFileAction,
  renamingKey,
  renamePending = false,
  onRenameStart,
  onRenameCancel,
  onRename,
}: DiffFileListProps) {
  const { t } = useI18n();
  const [transferPending, setTransferPending] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [contextMenu, setContextMenu] = useState<
    { key: string; point: FileActionMenuPoint } | undefined
  >();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CollapsibleGroup>>(() => new Set());
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(selectedKey ? [selectedKey] : []),
  );
  const [renameDraft, setRenameDraft] = useState('');
  const selectionAnchorRef = useRef<string | undefined>(selectedKey || undefined);
  const pendingFocusRef = useRef<PendingFocus | undefined>(undefined);
  const pendingTrashFocusRef = useRef<PendingTrashFocus | undefined>(undefined);
  const selectionRepoRef = useRef(repoId);
  const focusExpiryRef = useRef<number | undefined>(undefined);
  const checkboxRefs = useRef(new Map<string, HTMLInputElement>());
  const groupCheckboxRefs = useRef(new Map<StageGroup, HTMLInputElement>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const groupFocusRefs = useRef(new Map<DisplayGroup, HTMLElement>());
  const focusedRepoRef = useRef<RepoId | undefined>(undefined);
  const renameInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!renamingKey) return undefined;
    const entry = entries.find((candidate) => entryKey(candidate) === renamingKey);
    if (!entry) return undefined;
    setRenameDraft(fileName(entry.path));
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
    return undefined;
  }, [entries, renamingKey]);

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
          label: t('diff'),
          entries: entries.filter((entry) => entry.area !== 'conflicted'),
        },
      ];
  const rowsByGroup = new Map(
    groups.map((group) => [
      group.id,
      changeListRows(group.entries, group.id, display, collapsedDirectories),
    ]),
  );
  const orderedEntryKeys = groups.flatMap(
    (group) =>
      rowsByGroup
        .get(group.id)
        ?.flatMap((row) => (row.kind === 'file' ? [entryKey(row.entry)] : [])) ?? [],
  );
  const allEntryKeys = groups.flatMap((group) => group.entries.map(entryKey));

  useEffect(() => {
    if (focusedRepoRef.current === repoId || !selectedKey) return;
    const target = rowRefs.current.get(selectedKey);
    if (!target) return;
    target.focus();
    focusedRepoRef.current = repoId;
  }, [entries, repoId, selectedKey]);

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
    if (event.target instanceof HTMLInputElement) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    updateSelectedKeys(new Set(allEntryKeys));
    const anchor = selectedKey || allEntryKeys[0];
    selectionAnchorRef.current = anchor;
    if (!selectedKey && anchor) onSelect(anchor);
  };
  const moveFileSelection = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    key: string,
    offset: -1 | 1,
  ): void => {
    event.currentTarget.closest('.change-groups')?.classList.add('is-keyboard-navigating');
    const group = groups.find((candidate) =>
      candidate.entries.some((entry) => entryKey(entry) === key),
    );
    const groupEntryKeys = group
      ? rowsByGroup
          .get(group.id)
          ?.flatMap((row) => (row.kind === 'file' ? [entryKey(row.entry)] : []))
      : undefined;
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

  useEffect(() => setCollapsedDirectories(new Set()), [display, repoId]);

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

  const startRename = (entry: ChangeEntry): void => {
    if (
      fileActionsDisabled ||
      fileRenameDisabled ||
      entry.area === 'conflicted' ||
      entry.status === 'deleted' ||
      !onRenameStart
    )
      return;
    onRenameStart(entry);
  };

  const submitRename = (entry: ChangeEntry): void => {
    if (!onRename || renamePending) return;
    if (renameDraft === fileName(entry.path)) {
      onRenameCancel?.();
      return;
    }
    void onRename(entry, renameDraft).catch(() => undefined);
  };

  return (
    <fieldset
      className={`change-groups${splitStageView ? '' : ' is-stage-hidden'}${splitStageView && collapsedGroups.has('staged') ? ' is-staged-collapsed' : ''}${splitStageView && collapsedGroups.has('worktree') ? ' is-worktree-collapsed' : ''}`}
      onKeyDown={selectAllFiles}
      onPointerMove={(event) => event.currentTarget.classList.remove('is-keyboard-navigating')}
    >
      <legend className="sr-only">{t('diff')}</legend>
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
            aria-label={id === 'combined' ? label : undefined}
            aria-labelledby={id === 'combined' ? undefined : titleId}
          >
            {id === 'combined' ? null : (
              <div className={`change-group-header${collapsibleGroup ? ' is-collapsible' : ''}`}>
                {stageGroup && splitStageView ? (
                  <label className="stage-toggle-hitbox" htmlFor={`stage-group-${id}`}>
                    <Input
                      id={`stage-group-${id}`}
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
                        context: id === 'staged' ? 'staged' : 'unstaged',
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
                {collapsibleGroup ? (
                  <Button
                    className="change-group-collapse-toggle"
                    type="button"
                    aria-expanded={!groupCollapsed}
                    aria-controls={contentId}
                    aria-label={t(groupCollapsed ? 'expandChangeGroup' : 'collapseChangeGroup', {
                      area: label,
                    })}
                    tooltip={t(groupCollapsed ? 'expandChangeGroup' : 'collapseChangeGroup', {
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
                  </Button>
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
              </div>
            )}
            <div id={contentId} className="change-group-content" hidden={groupCollapsed}>
              {groupEntries.length ? (
                <ul className={`change-list${display === 'tree' ? ' is-tree' : ''}`}>
                  {rowsByGroup.get(id)?.map((row) => {
                    if (row.kind === 'directory') {
                      const key = directoryKey(id, row.path);
                      const collapsed = collapsedDirectories.has(key);
                      return (
                        <li key={key} className="change-tree-directory">
                          <Button
                            type="button"
                            aria-expanded={!collapsed}
                            aria-label={t(collapsed ? 'expandDirectory' : 'collapseDirectory', {
                              path: row.path,
                            })}
                            style={{ paddingLeft: 16 + row.depth * 14 }}
                            onClick={() =>
                              setCollapsedDirectories((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                          >
                            {collapsed ? (
                              <ChevronRight aria-hidden="true" focusable="false" />
                            ) : (
                              <ChevronDown aria-hidden="true" focusable="false" />
                            )}
                            <Folder aria-hidden="true" focusable="false" />
                            <span>{row.name}</span>
                          </Button>
                        </li>
                      );
                    }
                    const entry = row.entry;
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
                      selectedEntries.some((candidate) => candidate.area !== 'unstaged');
                    const stageToggleId = `stage-entry-${encodeURIComponent(key)}`;
                    const renaming = renamingKey === key;
                    const rowClassName = `change-row${display === 'nameAndPath' ? '' : ' is-single-line'}${display === 'fullPath' ? ' is-full-path' : ''}${renaming ? ' is-renaming' : ''}`;
                    const rowStyle =
                      display === 'tree' ? { paddingLeft: 26 + row.depth * 14 } : undefined;
                    const rowContent = (
                      <>
                        <FileStatusIcon status={entry.status} />
                        <span
                          className={`file-path${display === 'nameAndPath' ? '' : ' is-single-line'}`}
                        >
                          <span className="file-name">
                            {renaming ? (
                              <Input
                                ref={renameInputRef}
                                className="rename-file-input"
                                value={renameDraft}
                                disabled={renamePending}
                                aria-label={t('renameFileName', { path: entry.path })}
                                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                                onBlur={() => submitRename(entry)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    submitRename(entry);
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    onRenameCancel?.();
                                  }
                                }}
                              />
                            ) : (
                              <strong>
                                {display === 'fullPath' ? entry.path : fileName(entry.path)}
                              </strong>
                            )}
                            {!renaming && unsavedFileKey === key ? (
                              <output className="unsaved-file-dot" aria-label={t('unsaved')} />
                            ) : null}
                          </span>
                          {display === 'nameAndPath' ? (
                            <small>{parentPath(entry.path)}</small>
                          ) : null}
                        </span>
                        {entry.additions !== undefined || entry.deletions !== undefined ? (
                          <span className="diff-stat">
                            <i>+{entry.additions ?? 0}</i>
                            <b>−{entry.deletions ?? 0}</b>
                          </span>
                        ) : null}
                      </>
                    );
                    return (
                      <li
                        key={key}
                        className={`change-item${selectedKeys.has(key) ? ' is-selected' : ''}${selectedKey === key ? ' is-current' : ''}`}
                      >
                        {entryStageableArea && splitStageView ? (
                          <label className="stage-toggle-hitbox" htmlFor={stageToggleId}>
                            <Input
                              id={stageToggleId}
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
                        {renaming ? (
                          <div className={rowClassName} style={rowStyle}>
                            {rowContent}
                          </div>
                        ) : (
                          <Button
                            ref={(element) => {
                              if (element) rowRefs.current.set(key, element);
                              else rowRefs.current.delete(key);
                            }}
                            type="button"
                            className={rowClassName}
                            style={rowStyle}
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
                            onDoubleClick={() => startRename(entry)}
                            onContextMenu={(event) => openContextMenu(event, key)}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowUp') moveFileSelection(event, key, -1);
                              else if (event.key === 'ArrowDown') moveFileSelection(event, key, 1);
                            }}
                          >
                            {rowContent}
                          </Button>
                        )}
                        <FileActionMenu
                          path={entry.path}
                          selectedPaths={selectedPaths}
                          open={openMenuKey === key}
                          disabled={fileActionsDisabled}
                          editing={editingFileKey === key}
                          editDisabled={fileEditDisabled || invalidFileActionEntry}
                          renameDisabled={
                            fileRenameDisabled ||
                            selectedPaths.length !== 1 ||
                            invalidFileActionEntry ||
                            !onRenameStart
                          }
                          openDisabled={
                            fileOpenDisabled || selectedPaths.length !== 1 || invalidFileActionEntry
                          }
                          revealDisabled={selectedEntries.some(
                            (candidate) => candidate.status === 'deleted',
                          )}
                          discardDisabled={discardDisabled}
                          deleteDisabled={fileTrashDisabled || invalidFileActionEntry}
                          imagePreview={imagePreview?.(entry)}
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
                          onAction={(fileAction) => {
                            if (fileAction === 'renameFile') {
                              startRename(entry);
                              return Promise.resolve();
                            }
                            return runFileAction(
                              fileAction === 'editFile' ? [entry] : selectedEntries,
                              fileAction,
                            );
                          }}
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
