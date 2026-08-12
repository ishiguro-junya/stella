import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  acceptChoiceDocument,
  allConflictBlocksResolved,
  createChoiceStamp,
  createConflictHistory,
  editConflictResult,
  isChoiceResponseCurrent,
  isConflictDirty,
  markConflictSaved,
  redoConflictHistory,
  replaceConflictFromExternal,
  undoConflictHistory,
  type ConflictHistoryState,
} from '../../domain/conflictSession';
import { profileConflictDocument } from '../../domain/performance';
import type { ConflictChoice, ConflictDocument, DiffStyle } from '../../domain/workspace';
import type { UnsavedChangesHandle } from '../../domain/unsavedChanges';
import { useI18n, type I18nValue, type LocalizedMessage } from '../../i18n/i18n';
import { DiffSurface } from '../diff/DiffSurface';
import { Dialog } from '../../ui/Dialog';
import { isWorkspaceErrorHandled, type ShowWorkspaceError } from '../../ui/WorkspaceErrorDialog';
import {
  describeWorkspaceError,
  WorkspaceErrorDetails,
  type WorkspaceErrorContent,
} from '../../ui/WorkspaceErrorDetails';
import { ConflictResultEditor } from './ConflictResultEditor';

export interface ConflictChoiceInput {
  conflict: ConflictDocument;
  blockId: string;
  choice: ConflictChoice;
  draftText: string;
  documentRevision: string;
  baseDocumentRevision: string;
}

export interface ConflictSaveInput {
  conflict: ConflictDocument;
  draftText: string;
  documentRevision: string;
}

export interface ConflictSurfaceActions {
  choose: (input: ConflictChoiceInput) => Promise<ConflictDocument>;
  save: (input: ConflictSaveInput) => Promise<ConflictDocument>;
  markResolved: (conflict: ConflictDocument) => Promise<void>;
  reload: (conflict: ConflictDocument) => Promise<ConflictDocument>;
  materialize: (conflict: ConflictDocument, choice: ConflictChoice) => Promise<void>;
  openExternal: (conflict: ConflictDocument) => Promise<void>;
}

export interface ConflictSurfaceProps {
  document: ConflictDocument;
  actions: ConflictSurfaceActions;
  diffStyle?: DiffStyle | undefined;
  externalStateChanged?: boolean | undefined;
  lineWrapping?: boolean | undefined;
  wrapColumn?: number | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onResolved?: (() => void) | undefined;
  onLeaveHandleChange?: ((handle: UnsavedChangesHandle | null) => void) | undefined;
  onError?: ShowWorkspaceError | undefined;
}

type ComparisonSide = 'current' | 'incoming';
type BusyOperation = 'choice' | 'save' | 'mark' | 'reload' | 'materialize' | 'external' | null;

const OPERATION_LABELS: Record<ConflictDocument['operation'], LocalizedMessage> = {
  merge: { id: 'merge' },
  rebase: { id: 'rebase' },
  cherryPick: { id: 'cherryPick' },
  revert: { id: 'revert' },
};

function cloneWorkingDocument(
  base: ConflictDocument,
  history: ConflictHistoryState,
): ConflictDocument {
  return {
    ...base,
    contentHash: history.present.contentHash,
    result: { ...base.result, text: history.present.resultText },
    blocks: history.present.blocks.map((block) => ({
      ...block,
      rangeUtf16: { ...block.rangeUtf16 },
      replacements: { ...block.replacements },
    })),
  };
}

function blockStateLabel(
  state: ConflictDocument['blocks'][number]['state'],
  t: I18nValue['t'],
): string {
  switch (state) {
    case 'unresolved':
      return t('conflictUnresolved');
    case 'current':
      return t('conflictUsedCurrent');
    case 'incoming':
      return t('conflictUsedIncoming');
    case 'both':
      return t('conflictUsedBoth');
    case 'manual':
      return t('conflictManuallyEdited');
  }
  throw new Error('Unknown conflict block state');
}

function preferredBlockId(document: ConflictDocument): string | undefined {
  return (
    document.blocks.find((block) => block.state === 'unresolved')?.id ?? document.blocks[0]?.id
  );
}

export function ConflictSurface({
  document,
  actions,
  diffStyle = 'unified',
  externalStateChanged = false,
  lineWrapping = false,
  wrapColumn,
  onDirtyChange,
  onResolved,
  onLeaveHandleChange,
  onError,
}: ConflictSurfaceProps) {
  const { t, message } = useI18n();
  const [baseDocument, setBaseDocument] = useState(document);
  const [history, setHistoryState] = useState(() => createConflictHistory(document));
  const [comparisonSide, setComparisonSide] = useState<ComparisonSide>('current');
  const [selectedBlockId, setSelectedBlockId] = useState(preferredBlockId(document));
  const [busy, setBusy] = useState<BusyOperation>(null);
  const [announcement, setAnnouncement] = useState<LocalizedMessage>();
  const [error, setError] = useState<WorkspaceErrorContent>();
  const [externalDocument, setExternalDocument] = useState<ConflictDocument>();
  const [confirmReload, setConfirmReload] = useState(false);
  const historyRef = useRef(history);
  const baseDocumentRef = useRef(baseDocument);
  const latestRequestId = useRef(0);
  const markResolvedRef = useRef<HTMLButtonElement | null>(null);
  const comparisonTabRefs = useRef<Record<ComparisonSide, HTMLButtonElement | null>>({
    current: null,
    incoming: null,
  });
  const saveRef = useRef<() => Promise<boolean>>(async () => false);

  const updateHistory = (
    updater: (current: ConflictHistoryState) => ConflictHistoryState,
  ): void => {
    setHistoryState((current) => {
      const next = updater(current);
      historyRef.current = next;
      return next;
    });
  };

  const updateBaseDocument = (next: ConflictDocument): void => {
    baseDocumentRef.current = next;
    setBaseDocument(next);
  };

  const reportRuntimeError = (title: string, cause: unknown, fallback: string): void => {
    if (isWorkspaceErrorHandled(cause)) return;
    if (onError) {
      setError(undefined);
      onError(title, cause, fallback);
      return;
    }
    setError(describeWorkspaceError(cause, fallback));
  };

  const dirty = isConflictDirty(history);
  const allResolved = allConflictBlocksResolved(history);
  const workingDocument = useMemo(
    () => cloneWorkingDocument(baseDocument, history),
    [baseDocument, history],
  );
  const performance = useMemo(() => profileConflictDocument(workingDocument), [workingDocument]);
  const selectedBlock = history.present.blocks.find((block) => block.id === selectedBlockId);
  const selectedBlockIndex = selectedBlock
    ? history.present.blocks.findIndex((block) => block.id === selectedBlock.id)
    : -1;
  const unresolvedCount = history.present.blocks.filter(
    (block) => block.state === 'unresolved',
  ).length;
  const externalChangeDetected = Boolean(externalDocument) || externalStateChanged;
  const saveEnabled = dirty && !externalChangeDetected && !busy && performance.mode !== 'external';
  const markEnabled = !dirty && allResolved && !externalChangeDetected && !busy;

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    baseDocumentRef.current = baseDocument;
  }, [baseDocument]);

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

  useEffect(() => {
    const current = baseDocumentRef.current;
    if (document.path !== current.path) {
      updateBaseDocument(document);
      updateHistory(() => replaceConflictFromExternal(document));
      setExternalDocument(undefined);
      setSelectedBlockId(preferredBlockId(document));
      return;
    }
    if (
      document.conflictGeneration === current.conflictGeneration &&
      document.contentHash === current.contentHash
    ) {
      if (document.sessionId !== current.sessionId) {
        ++latestRequestId.current;
        updateBaseDocument(document);
        updateHistory((state) => ({
          ...state,
          sessionId: document.sessionId,
          conflictGeneration: document.conflictGeneration,
        }));
      }
      return;
    }
    if (isConflictDirty(historyRef.current)) {
      setExternalDocument(document);
      setAnnouncement({ id: 'conflictExternalDetectedAnnouncement' });
      return;
    }
    updateBaseDocument(document);
    updateHistory(() => replaceConflictFromExternal(document));
    setSelectedBlockId(preferredBlockId(document));
    setAnnouncement({ id: 'conflictExternalReloadedAnnouncement' });
  }, [document]);

  const goToBlock = (direction: 1 | -1): void => {
    const unresolved = historyRef.current.present.blocks.filter(
      (block) => block.state === 'unresolved',
    );
    if (!unresolved.length) {
      markResolvedRef.current?.focus();
      setAnnouncement({ id: 'conflictNoneUnresolved' });
      return;
    }
    const currentIndex = unresolved.findIndex((block) => block.id === selectedBlockId);
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + direction + unresolved.length) % unresolved.length;
    const next = unresolved[nextIndex];
    if (!next) return;
    setSelectedBlockId(next.id);
    setAnnouncement({
      id: 'conflictPositionOf',
      args: {
        current: historyRef.current.present.blocks.indexOf(next) + 1,
        total: historyRef.current.present.blocks.length,
      },
    });
  };

  const choose = async (blockId: string, choice: ConflictChoice): Promise<void> => {
    if (busy || externalChangeDetected) return;
    const requestId = ++latestRequestId.current;
    const stateAtRequest = historyRef.current;
    const stamp = createChoiceStamp(stateAtRequest, requestId);
    const conflictAtRequest = cloneWorkingDocument(baseDocumentRef.current, stateAtRequest);
    setBusy('choice');
    setError(undefined);

    try {
      const response = await actions.choose({
        conflict: conflictAtRequest,
        blockId,
        choice,
        draftText: stateAtRequest.present.resultText,
        documentRevision: conflictAtRequest.documentRevision,
        baseDocumentRevision: stateAtRequest.present.baseDocumentRevision,
      });
      if (!isChoiceResponseCurrent(stamp, historyRef.current, latestRequestId.current)) {
        setAnnouncement({ id: 'conflictOutdatedChoice' });
        return;
      }
      updateBaseDocument(response);
      updateHistory((current) => acceptChoiceDocument(current, response));
      const nextUnresolved = response.blocks.find((block) => block.state === 'unresolved');
      setSelectedBlockId(
        nextUnresolved?.id ??
          response.blocks.find((block) => block.id === blockId)?.id ??
          response.blocks[0]?.id,
      );
      setAnnouncement({
        id: nextUnresolved ? 'conflictChoiceAppliedNext' : 'conflictChoiceAppliedSave',
        args: { choice },
      });
      if (!nextUnresolved) queueMicrotask(() => markResolvedRef.current?.focus());
    } catch (cause) {
      reportRuntimeError(t('conflictApplyFailedTitle'), cause, t('conflictApplyFailed'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!saveEnabled) return false;
    const requestId = ++latestRequestId.current;
    const stateAtRequest = historyRef.current;
    const stamp = createChoiceStamp(stateAtRequest, requestId);
    const conflictAtRequest = cloneWorkingDocument(baseDocumentRef.current, stateAtRequest);
    setBusy('save');
    setError(undefined);

    try {
      const response = await actions.save({
        conflict: conflictAtRequest,
        draftText: stateAtRequest.present.resultText,
        documentRevision: conflictAtRequest.documentRevision,
      });
      if (!isChoiceResponseCurrent(stamp, historyRef.current, latestRequestId.current)) {
        setAnnouncement({ id: 'conflictOutdatedSave' });
        return false;
      }
      updateBaseDocument(response);
      updateHistory((current) => markConflictSaved(current, response));
      setAnnouncement({ id: 'conflictSavedAnnouncement' });
      return true;
    } catch (cause) {
      reportRuntimeError(t('conflictSaveFailedTitle'), cause, t('conflictSaveFailed'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  saveRef.current = save;

  useEffect(() => {
    if (!onLeaveHandleChange) return () => undefined;
    const handle: UnsavedChangesHandle = { save: () => saveRef.current() };
    onLeaveHandleChange(handle);
    return () => onLeaveHandleChange(null);
  }, [onLeaveHandleChange]);

  const markResolved = async (): Promise<void> => {
    if (!markEnabled) return;
    setBusy('mark');
    setError(undefined);
    try {
      await actions.markResolved(cloneWorkingDocument(baseDocumentRef.current, historyRef.current));
      setAnnouncement({ id: 'conflictMarkedResolvedAnnouncement' });
      onResolved?.();
    } catch (cause) {
      reportRuntimeError(t('conflictMarkFailedTitle'), cause, t('conflictMarkFailed'));
    } finally {
      setBusy(null);
    }
  };

  const reloadExternal = async (): Promise<void> => {
    setConfirmReload(false);
    setBusy('reload');
    setError(undefined);
    try {
      const response = externalDocument ?? (await actions.reload(baseDocumentRef.current));
      ++latestRequestId.current;
      updateBaseDocument(response);
      updateHistory(() => replaceConflictFromExternal(response));
      setExternalDocument(undefined);
      setSelectedBlockId(preferredBlockId(response));
      setAnnouncement({ id: 'conflictExternalReloadedAnnouncement' });
    } catch (cause) {
      reportRuntimeError(t('conflictReloadFailedTitle'), cause, t('conflictReloadFailed'));
    } finally {
      setBusy(null);
    }
  };

  const copyDraft = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(historyRef.current.present.resultText);
      setAnnouncement({ id: 'conflictCopiedAnnouncement' });
    } catch (cause) {
      reportRuntimeError(t('conflictCopyFailedTitle'), cause, t('conflictCopyFailed'));
    }
  };

  const openExternal = async (): Promise<void> => {
    setBusy('external');
    setError(undefined);
    try {
      await actions.openExternal(workingDocument);
      setAnnouncement({ id: 'conflictOpenedExternalAnnouncement' });
    } catch (cause) {
      reportRuntimeError(
        t('conflictOpenExternalFailedTitle'),
        cause,
        t('conflictOpenExternalFailed'),
      );
    } finally {
      setBusy(null);
    }
  };

  const materialize = async (choice: ConflictChoice): Promise<void> => {
    if (busy || externalChangeDetected) return;
    setBusy('materialize');
    setError(undefined);
    try {
      await actions.materialize(workingDocument, choice);
      setAnnouncement({ id: 'conflictPreviewAppliedAnnouncement', args: { choice } });
    } catch (cause) {
      reportRuntimeError(t('conflictWholeFileFailedTitle'), cause, t('conflictWholeFileFailed'));
    } finally {
      setBusy(null);
    }
  };

  const supportsWholeFileChoice =
    workingDocument.kind === 'addAdd' || workingDocument.kind === 'modifyDelete';
  const wholeFileChoices: ConflictChoice[] = supportsWholeFileChoice
    ? [
        ...(workingDocument.capabilities.chooseCurrent ? ['current' as const] : []),
        ...(workingDocument.capabilities.chooseIncoming ? ['incoming' as const] : []),
        ...(workingDocument.capabilities.chooseBoth ? ['both' as const] : []),
        ...(workingDocument.capabilities.delete ? ['delete' as const] : []),
      ]
    : [];

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      event.stopPropagation();
      void save();
      return;
    }
    if (event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void markResolved();
      return;
    }
    if (key === 'g') {
      event.preventDefault();
      event.stopPropagation();
      goToBlock(event.shiftKey ? -1 : 1);
    }
  };

  const target =
    comparisonSide === 'current' ? workingDocument.sides.current : workingDocument.sides.incoming;
  const targetLabel =
    comparisonSide === 'current' ? workingDocument.labels.current : workingDocument.labels.incoming;

  const handleComparisonTabKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    side: ComparisonSide,
  ): void => {
    let next: ComparisonSide | undefined;
    if (event.key === 'ArrowLeft') next = side === 'current' ? 'incoming' : 'current';
    else if (event.key === 'ArrowRight') next = side === 'current' ? 'incoming' : 'current';
    else if (event.key === 'Home') next = 'current';
    else if (event.key === 'End') next = 'incoming';
    if (!next) return;
    event.preventDefault();
    setComparisonSide(next);
    comparisonTabRefs.current[next]?.focus();
  };

  return (
    <section
      className="conflict-surface"
      aria-labelledby="conflict-title"
      onKeyDownCapture={handleKeyboard}
    >
      <header className="conflict-header">
        <div>
          <p className="eyebrow">
            {t('conflictEyebrow', {
              operation: message(OPERATION_LABELS[workingDocument.operation]),
            })}
          </p>
          <h2 id="conflict-title">{workingDocument.path}</h2>
          <p className="conflict-labels">
            {t('conflictLabels', {
              current: message(workingDocument.labels.current),
              incoming: message(workingDocument.labels.incoming),
            })}
          </p>
        </div>
        <span className={unresolvedCount ? 'status-badge warning' : 'status-badge success'}>
          {t('unresolvedCount', { count: unresolvedCount })}
        </span>
      </header>

      {externalChangeDetected ? (
        <div className="inline-alert warning" role="alert">
          <div>
            <strong>{t('conflictExternalChangesDetected')}</strong>
            <p>{t('conflictExternalChangesPreserved')}</p>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void copyDraft()}>
              {t('conflictCopyResult')}
            </button>
            <button type="button" className="danger-quiet" onClick={() => setConfirmReload(true)}>
              {t('conflictReloadExternalChanges')}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-alert error" role="alert">
          <WorkspaceErrorDetails error={error} />
        </div>
      ) : null}
      {performance.mode === 'performance' ? (
        <output className="inline-alert info">
          {t('conflictPerformanceMode', {
            kib: Math.ceil(performance.bytes / 1024),
            lines: performance.lines,
          })}
        </output>
      ) : null}

      {performance.mode === 'external' ? (
        <div className="external-conflict-panel">
          <p className="eyebrow">{t('conflictExternalRequired')}</p>
          <h3>{t('conflictCannotEditBuiltIn')}</h3>
          <p>
            {performance.reason === 'tooLarge'
              ? t('conflictTooLarge', {
                  mib: Math.ceil(performance.bytes / 1024 / 1024),
                  lines: performance.lines,
                })
              : performance.reason === 'binary'
                ? t('conflictBinaryExternal')
                : t('conflictStructureExternal')}
          </p>
          <div className="button-row">
            {wholeFileChoices.map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void materialize(choice)}
              >
                {choice === 'current'
                  ? t('conflictCurrent')
                  : choice === 'incoming'
                    ? t('conflictIncoming')
                    : choice === 'both'
                      ? t('conflictBoth')
                      : t('delete')}
              </button>
            ))}
            {workingDocument.capabilities.externalEditor ? (
              <button
                type="button"
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => void openExternal()}
              >
                {t('conflictOpenExternalEditor')}
              </button>
            ) : null}
            <button type="button" disabled={Boolean(busy)} onClick={() => void reloadExternal()}>
              {t('conflictReloadGitStatus')}
            </button>
            <button
              ref={markResolvedRef}
              type="button"
              className="primary"
              disabled={!markEnabled}
              onClick={() => void markResolved()}
            >
              {t('conflictMarkResolved')}
            </button>
          </div>
        </div>
      ) : (
        <div className="conflict-workspace">
          <section className="conflict-comparison" aria-labelledby="comparison-title">
            <div className="pane-toolbar">
              <h3 id="comparison-title">{t('conflictCompareBase')}</h3>
              <div className="segmented" role="tablist" aria-label={t('conflictComparisonSide')}>
                {(['current', 'incoming'] as const).map((side) => (
                  <button
                    key={side}
                    ref={(element) => {
                      comparisonTabRefs.current[side] = element;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={comparisonSide === side}
                    tabIndex={comparisonSide === side ? 0 : -1}
                    onClick={() => setComparisonSide(side)}
                    onKeyDown={(event) => handleComparisonTabKey(event, side)}
                  >
                    {t(side === 'current' ? 'conflictCurrent' : 'conflictIncoming')}
                  </button>
                ))}
              </div>
            </div>
            <DiffSurface
              source={{
                kind: 'fileDiff',
                path: workingDocument.path,
                baseText: workingDocument.sides.base?.text ?? '',
                targetText: target?.text ?? '',
                baseLabel: t('conflictBase'),
                targetLabel: message(targetLabel),
                cacheKey: `${workingDocument.sessionId}:${workingDocument.conflictGeneration}:${comparisonSide}`,
              }}
              diffStyle={diffStyle}
              lineWrapping={lineWrapping}
              wrapColumn={wrapColumn}
              performanceMode={performance.mode === 'performance'}
              ariaLabel={t('conflictDiffAria', {
                side: t(comparisonSide === 'current' ? 'conflictCurrent' : 'conflictIncoming'),
              })}
            />

            <ol className="conflict-block-list" aria-label={t('conflictBlocks')}>
              {history.present.blocks.map((block, index) => (
                <li key={block.id} data-state={block.state}>
                  <button
                    type="button"
                    className="block-selector"
                    aria-current={selectedBlockId === block.id ? 'true' : undefined}
                    onClick={() => setSelectedBlockId(block.id)}
                  >
                    <span>
                      {t('conflictPosition', {
                        current: index + 1,
                        total: history.present.blocks.length,
                      })}
                    </span>
                    <span>{blockStateLabel(block.state, t)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="conflict-result" aria-labelledby="result-title">
            <div className="pane-toolbar">
              <div>
                <h3 id="result-title">{t('conflictResult')}</h3>
                <span className="save-state">{t(dirty ? 'conflictUnsaved' : 'conflictSaved')}</span>
              </div>
              <div className="button-row compact">
                <button
                  type="button"
                  aria-label={t('undo')}
                  disabled={!history.past.length || Boolean(busy)}
                  onClick={() => updateHistory(undoConflictHistory)}
                >
                  {t('undo')}
                </button>
                <button
                  type="button"
                  aria-label={t('redo')}
                  disabled={!history.future.length || Boolean(busy)}
                  onClick={() => updateHistory(redoConflictHistory)}
                >
                  {t('redo')}
                </button>
                <button type="button" disabled={!saveEnabled} onClick={() => void save()}>
                  {t('save')} <kbd>⌘S</kbd>
                </button>
                <button
                  ref={markResolvedRef}
                  type="button"
                  className="primary"
                  disabled={!markEnabled}
                  aria-describedby="mark-resolved-condition"
                  onClick={() => void markResolved()}
                >
                  {t('conflictMarkResolved')}
                </button>
              </div>
            </div>
            {selectedBlock && selectedBlockIndex >= 0 ? (
              <fieldset
                className="conflict-resolution-bar"
                aria-label={t('conflictResolutionOptions', { index: selectedBlockIndex + 1 })}
              >
                <legend>
                  {t('conflictPosition', {
                    current: selectedBlockIndex + 1,
                    total: history.present.blocks.length,
                  })}{' '}
                  · {blockStateLabel(selectedBlock.state, t)}
                </legend>
                <div className="choice-buttons">
                  {(['current', 'incoming', 'both'] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      disabled={
                        Boolean(busy) ||
                        externalChangeDetected ||
                        (choice === 'current' && !workingDocument.capabilities.chooseCurrent) ||
                        (choice === 'incoming' && !workingDocument.capabilities.chooseIncoming) ||
                        (choice === 'both' && !workingDocument.capabilities.chooseBoth)
                      }
                      aria-label={t('conflictApplyChoice', {
                        choice,
                        index: selectedBlockIndex + 1,
                      })}
                      onClick={() => void choose(selectedBlock.id, choice)}
                    >
                      {choice === 'current'
                        ? t('conflictUseCurrent')
                        : choice === 'incoming'
                          ? t('conflictUseIncoming')
                          : t('conflictUseBoth')}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <p id="mark-resolved-condition" className="sr-only">
              {t('conflictMarkCondition')}
            </p>
            <ConflictResultEditor
              value={history.present.resultText}
              path={workingDocument.path}
              lineEnding={workingDocument.result.lineEnding}
              readOnly={Boolean(busy) || externalChangeDetected}
              performanceMode={performance.mode === 'performance'}
              lineWrapping={lineWrapping}
              wrapColumn={wrapColumn}
              selectedRange={selectedBlock?.rangeUtf16}
              onChange={(value) => updateHistory((current) => editConflictResult(current, value))}
              onUndo={() => updateHistory(undoConflictHistory)}
              onRedo={() => updateHistory(redoConflictHistory)}
              onSave={() => void save()}
              onMarkResolved={() => void markResolved()}
            />
          </section>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement ? message(announcement) : ''}
      </p>

      {confirmReload ? (
        <Dialog labelledBy="reload-title" onDismiss={() => setConfirmReload(false)}>
          <h3 id="reload-title">{t('conflictDiscardUnsaved')}</h3>
          <p>{t('conflictReloadDiscardDescription')}</p>
          <div className="button-row end">
            <button type="button" data-dialog-initial-focus onClick={() => setConfirmReload(false)}>
              {t('cancel')}
            </button>
            <button type="button" className="danger" onClick={() => void reloadExternal()}>
              {t('conflictDiscardReload')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
