import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '../../ui/Button';
import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import type { ChangeEntry, FileDocument } from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { Dialog, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { FileStatusIcon } from '../../ui/FileStatusIcon';
import { TextEditor } from '../../ui/TextEditor';
import { describeWorkspaceError, WorkspaceErrorDetails } from '../../ui/WorkspaceErrorDetails';
import { FileViewModeToggle } from './FileViewModeToggle';

export interface FileEditorSaveInput {
  path: string;
  text: string;
  expectedContentHash: string;
}

export interface FileEditorSurfaceProps {
  document: FileDocument;
  entry: ChangeEntry;
  busy: boolean;
  externalStateChanged?: boolean | undefined;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  initialScrollLine?: number | undefined;
  leadingHeaderActions?: ReactNode | undefined;
  headerActions?: ReactNode | undefined;
  onDisplay: () => void;
  onSave: (input: FileEditorSaveInput) => Promise<FileDocument | undefined>;
  onReload: () => Promise<FileDocument>;
  onSaved: (document: FileDocument | undefined) => void;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onLeaveHandleChange?: ((handle: UnsavedChangesHandle | null) => void) | undefined;
}

function performanceMode(text: string): boolean {
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) return true;
  return text.split(/\r?\n/u).length > 20_000;
}

export function FileEditorSurface({
  document,
  entry,
  busy,
  externalStateChanged = false,
  lineWrapping = false,
  wrapColumn,
  initialScrollLine,
  leadingHeaderActions,
  headerActions,
  onDisplay,
  onSave,
  onReload,
  onSaved,
  onDirtyChange,
  onLeaveHandleChange,
}: FileEditorSurfaceProps) {
  const { t } = useI18n();
  const [base, setBase] = useState(document);
  const [draft, setDraft] = useState(document.text);
  const [externalDocument, setExternalDocument] = useState<FileDocument>();
  const [saving, setSaving] = useState(false);
  const [confirmDisplay, setConfirmDisplay] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [error, setError] = useState<ReturnType<typeof describeWorkspaceError>>();
  const [announcement, setAnnouncement] = useState('');
  const baseRef = useRef(base);
  const draftRef = useRef(draft);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const dirty = draft !== base.text;
  const externalChangeDetected = Boolean(externalDocument) || externalStateChanged;
  const canSave = dirty && !externalChangeDetected && !busy && !saving;
  const editorPerformanceMode = useMemo(() => performanceMode(base.text), [base.text]);

  baseRef.current = base;
  draftRef.current = draft;

  useEffect(() => {
    if (document.path !== baseRef.current.path) {
      setBase(document);
      setDraft(document.text);
      setExternalDocument(undefined);
      setError(undefined);
      return;
    }
    if (document.contentHash === baseRef.current.contentHash) {
      setBase((current) => ({ ...current, generation: document.generation }));
      return;
    }
    if (draftRef.current !== baseRef.current.text) {
      setExternalDocument(document);
      setAnnouncement(t('fileEditExternalDetected'));
      return;
    }
    setBase(document);
    setDraft(document.text);
    setAnnouncement(t('fileEditExternalReloaded'));
  }, [document, t]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, onDirtyChange]);

  const save = async (): Promise<boolean> => {
    if (!canSave) return false;
    setSaving(true);
    setError(undefined);
    try {
      const refreshed = await onSave({
        path: baseRef.current.path,
        text: draftRef.current,
        expectedContentHash: baseRef.current.contentHash,
      });
      if (refreshed) {
        setBase(refreshed);
        setDraft(refreshed.text);
      }
      setAnnouncement(t('fileEditSaved'));
      onSaved(refreshed);
      return true;
    } catch (cause) {
      try {
        const latest = await onReload();
        if (latest.contentHash !== baseRef.current.contentHash) {
          setExternalDocument(latest);
          setAnnouncement(t('fileEditExternalDetected'));
          return false;
        }
      } catch {
        // 保存エラーを優先して表示する。
      }
      setError(describeWorkspaceError(cause, t('fileEditSaveFailed')));
      return false;
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  useEffect(() => {
    if (!onLeaveHandleChange) return () => undefined;
    const handle: UnsavedChangesHandle = {
      save: () => saveRef.current(),
      relocationDraft: () => ({
        kind: 'file',
        path: baseRef.current.path,
        baseHash: baseRef.current.contentHash,
        text: draftRef.current,
      }),
    };
    onLeaveHandleChange(handle);
    return () => onLeaveHandleChange(null);
  }, [onLeaveHandleChange]);

  const reload = async (): Promise<void> => {
    setConfirmReload(false);
    setError(undefined);
    try {
      const refreshed = externalDocument ?? (await onReload());
      setBase(refreshed);
      setDraft(refreshed.text);
      setExternalDocument(undefined);
      setAnnouncement(t('fileEditExternalReloaded'));
    } catch (cause) {
      setError(describeWorkspaceError(cause, t('fileEditReloadFailed')));
    }
  };

  const copyDraft = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(draftRef.current);
      setAnnouncement(t('fileEditDraftCopied'));
    } catch (cause) {
      setError(describeWorkspaceError(cause, t('fileEditCopyFailed')));
    }
  };

  const requestDisplay = (): void => {
    if (dirty) {
      setConfirmDisplay(true);
      return;
    }
    onDisplay();
  };

  const saveAndDisplay = async (): Promise<void> => {
    setConfirmDisplay(false);
    if (await saveRef.current()) onDisplay();
  };

  return (
    <main className="pane diff-content-pane file-editor-pane" aria-labelledby="file-editor-title">
      <div className="pane-toolbar file-editor-toolbar">
        <div className="selected-file-heading">
          <FileStatusIcon status={entry.status} />
          <h2 id="file-editor-title" aria-label={entry.path}>
            {entry.path}
          </h2>
          {dirty ? <output className="unsaved-file-dot" aria-label={t('unsaved')} /> : null}
        </div>
        <div className="diff-file-actions">
          {leadingHeaderActions}
          <FileViewModeToggle
            mode="edit"
            displayDisabled={busy || saving}
            onDisplay={requestDisplay}
            onEdit={() => undefined}
          />
          {headerActions}
        </div>
      </div>
      {externalChangeDetected ? (
        <section
          className="inline-alert warning file-editor-external"
          aria-label={t('externalChange')}
        >
          <div>
            <strong>{t('fileEditExternalTitle')}</strong>
            <p>{t('fileEditExternalDescription')}</p>
          </div>
          <div className="button-row">
            <Button type="button" aria-label={t('copyDraft')} onClick={() => void copyDraft()}>
              {t('copy')}
            </Button>
            <Button type="button" onClick={() => setConfirmReload(true)}>
              {t('reload')}
            </Button>
          </div>
        </section>
      ) : null}
      {error ? (
        <div className="inline-alert error file-editor-error" role="alert">
          <WorkspaceErrorDetails error={error} />
        </div>
      ) : null}
      <div className="file-editor-body">
        <TextEditor
          value={draft}
          path={base.path}
          lineEnding={base.lineEnding}
          readOnly={saving || externalChangeDetected}
          performanceMode={editorPerformanceMode}
          lineWrapping={lineWrapping}
          wrapColumn={wrapColumn}
          initialScrollLine={initialScrollLine}
          ariaLabel={t('fileEditorAria', { path: base.path })}
          className="file-editor"
          onChange={setDraft}
          onSave={() => void saveRef.current()}
        />
      </div>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
      {confirmDisplay ? (
        <Dialog
          labelledBy="file-editor-display-title"
          describedBy="file-editor-display-description"
          role="alertdialog"
          onDismiss={() => setConfirmDisplay(false)}
        >
          <DialogHeader
            titleId="file-editor-display-title"
            title={t('unsavedChanges')}
            descriptionId="file-editor-display-description"
            description={t('saveOrDiscardBeforeDisplay')}
          />
          <DialogFooter>
            <Button
              type="button"
              data-dialog-initial-focus
              onClick={() => setConfirmDisplay(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="dangerQuiet"
              onClick={() => {
                setConfirmDisplay(false);
                onDisplay();
              }}
            >
              {t('displayWithoutSaving')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSave}
              onClick={() => void saveAndDisplay()}
            >
              {t('saveAndDisplay')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
      {confirmReload ? (
        <Dialog
          labelledBy="file-editor-reload-title"
          role="alertdialog"
          onDismiss={() => setConfirmReload(false)}
        >
          <DialogHeader
            titleId="file-editor-reload-title"
            title={t('fileEditDiscardTitle')}
            description={t('fileEditDiscardDescription')}
          />
          <DialogFooter>
            <Button type="button" data-dialog-initial-focus onClick={() => setConfirmReload(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={() => void reload()}>
              {t('discardAndReload')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </main>
  );
}
