/* oxlint-disable jsx-a11y/prefer-tag-over-role -- 共通Dialogのfocus stackを保ったまま非破壊操作をdialogとして公開する。 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import type { WorkspaceAdapter } from '../../adapters/workspaceAdapter';
import type {
  BranchSummary,
  RemoteDefinition,
  RepoSnapshot,
  WorkspaceAction,
} from '../../domain/workspace';
import { useI18n } from '../../i18n/i18n';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { SelectControl } from '../../ui/SelectControl';

type RemoteOperationKind = 'pull' | 'push';
type PushAction = Extract<WorkspaceAction, { kind: 'push' }>;

interface RemoteBranchTarget {
  remote: string;
  branch: string;
  label: string;
}

export interface RemoteOperationDialogProps {
  kind: RemoteOperationKind;
  repo: RepoSnapshot;
  adapter: WorkspaceAdapter;
  busy: boolean;
  onDismiss: () => void;
  onRefreshBranches: (remote: string) => Promise<void>;
  onPull: (remote: string, remoteBranch: string, commitMergeImmediately: boolean) => Promise<void>;
  onPush: (action: PushAction) => Promise<void>;
}

function splitRemoteBranch(
  value: string,
  remoteNames: readonly string[],
): RemoteBranchTarget | undefined {
  const shortName = value.startsWith('refs/remotes/') ? value.slice('refs/remotes/'.length) : value;
  const remote = remoteNames
    .toSorted((left, right) => right.length - left.length)
    .find((name) => shortName.startsWith(`${name}/`));
  const separator = remote ? remote.length : shortName.indexOf('/');
  if (separator <= 0 || shortName[separator] !== '/') return undefined;
  const resolvedRemote = remote ?? shortName.slice(0, separator);
  const branch = shortName.slice(separator + 1);
  if (!branch || branch === 'HEAD') return undefined;
  return { remote: resolvedRemote, branch, label: `${resolvedRemote}/${branch}` };
}

function remoteBranchTargets(
  branches: readonly BranchSummary[],
  remoteNames: readonly string[],
): RemoteBranchTarget[] {
  const targets = branches.flatMap((branch) => {
    if (!branch.remote) return [];
    const target = splitRemoteBranch(branch.fullName, remoteNames);
    return target ? [target] : [];
  });
  return targets
    .filter(
      (target, index) =>
        targets.findIndex((candidate) => candidate.label === target.label) === index,
    )
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function RemoteOperationDialog({
  kind,
  repo,
  adapter,
  busy,
  onDismiss,
  onRefreshBranches,
  onPull,
  onPush,
}: RemoteOperationDialogProps) {
  const { t } = useI18n();
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [remotes, setRemotes] = useState<RemoteDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [pullTarget, setPullTarget] = useState('');
  const [commitMergeImmediately, setCommitMergeImmediately] = useState(true);
  const [pushRemote, setPushRemote] = useState('');
  const [pushBranch, setPushBranch] = useState('');
  const [forceWithLease, setForceWithLease] = useState(false);
  const [pushTags, setPushTags] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const presentedRef = useRef(false);
  const remoteNames = useMemo(() => remotes.map((remote) => remote.name), [remotes]);
  const targets = useMemo(
    () => remoteBranchTargets(branches, remoteNames),
    [branches, remoteNames],
  );
  const upstreamTarget = useMemo(
    () => (repo.branch.upstream ? splitRemoteBranch(repo.branch.upstream, remoteNames) : undefined),
    [remoteNames, repo.branch.upstream],
  );
  const pushBranchSuggestions = targets.filter((target) => target.remote === pushRemote);
  const locked = busy || refreshing || submitting;
  const refreshRemote =
    kind === 'pull'
      ? (targets.find((candidate) => candidate.label === pullTarget)?.remote ??
        upstreamTarget?.remote ??
        remotes[0]?.name)
      : pushRemote || remotes[0]?.name;

  useEffect(() => {
    let cancelled = false;
    setLoading(!presentedRef.current);
    void Promise.all([
      adapter.query({ kind: 'branches', repoId: repo.repoId }),
      adapter.query({ kind: 'remotes', repoId: repo.repoId }),
    ])
      .then(([branchResult, remoteResult]) => {
        if (cancelled) return;
        if (branchResult.kind !== 'branches' || remoteResult.kind !== 'remotes') {
          throw new Error('Unexpected remote target response.');
        }
        setLoadError(false);
        const names = remoteResult.remotes.map((remote) => remote.name);
        const upstream = repo.branch.upstream
          ? splitRemoteBranch(repo.branch.upstream, names)
          : undefined;
        setBranches(branchResult.branches);
        setRemotes(remoteResult.remotes);
        if (kind === 'pull') {
          const availableTargets = remoteBranchTargets(branchResult.branches, names);
          const preferredRemote = names.includes('origin') ? 'origin' : names[0];
          const matchingCurrentBranch = repo.branch.name
            ? availableTargets.find(
                (target) => target.remote === preferredRemote && target.branch === repo.branch.name,
              )
            : undefined;
          setPullTarget((current) =>
            availableTargets.some((target) => target.label === current)
              ? current
              : upstream && availableTargets.some((target) => target.label === upstream.label)
                ? upstream.label
                : (matchingCurrentBranch?.label ?? ''),
          );
        } else {
          const initialRemote =
            (upstream && names.includes(upstream.remote) ? upstream.remote : undefined) ??
            (names.includes('origin') ? 'origin' : names[0]) ??
            '';
          setPushRemote((current) => (names.includes(current) ? current : initialRemote));
          setPushBranch(
            (current) =>
              current ||
              (upstream?.remote === initialRemote ? upstream.branch : (repo.branch.name ?? '')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) {
          presentedRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, kind, reloadSequence, repo.branch.name, repo.branch.upstream, repo.repoId]);

  const refreshBranches = async (): Promise<void> => {
    if (locked || !refreshRemote) return;
    setRefreshing(true);
    try {
      await onRefreshBranches(refreshRemote);
      setReloadSequence((current) => current + 1);
    } catch {
      // 呼び出し元の共通エラー表示を使用し、ダイアログは維持する。
      setRefreshing(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (locked || loading || loadError) return;
    const pullSelection = targets.find((candidate) => candidate.label === pullTarget);
    const remoteBranch = pushBranch.trim();
    if (kind === 'pull' ? !pullSelection : !pushRemote || !remoteBranch) return;
    setSubmitting(true);
    try {
      if (kind === 'pull') {
        await onPull(pullSelection!.remote, pullSelection!.branch, commitMergeImmediately);
      } else {
        await onPush({
          kind: 'push',
          remote: pushRemote,
          remoteBranch,
          forceWithLease,
          pushTags,
        });
      }
      onDismiss();
    } catch {
      // 呼び出し元がエラーを表示する間、入力内容を保持する。
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  const titleId = `${kind}-dialog-title`;
  return (
    <Dialog
      labelledBy={titleId}
      describedBy={`${kind}-dialog-description`}
      onDismiss={onDismiss}
      onSubmit={(event) => void submit(event)}
      role="dialog"
      className="remote-operation-dialog"
    >
      <DialogHeader
        titleId={titleId}
        title={t(kind)}
        descriptionId={`${kind}-dialog-description`}
        description={
          kind === 'pull'
            ? t('pullDialogDescription')
            : t('pushDialogDescription', { branch: repo.branch.name ?? 'HEAD' })
        }
      />
      <DialogBody
        className={`remote-operation-form remote-operation-form-${kind}`}
        aria-busy={loading || refreshing}
      >
        {loadError ? (
          <div className="remote-manager-error">
            <p>{t('loadRemoteTargetsFailed')}</p>
            <Button
              type="button"
              disabled={locked}
              onClick={() => {
                setRefreshing(true);
                setReloadSequence((current) => current + 1);
              }}
            >
              {t('retry')}
            </Button>
          </div>
        ) : null}
        {!loading && !loadError ? (
          <div className="dialog-form-field">
            <label htmlFor={`${kind}-local-branch`}>{t('localBranch')}</label>
            <Input
              id={`${kind}-local-branch`}
              className="remote-operation-source"
              value={repo.branch.name ?? 'HEAD'}
              disabled
            />
          </div>
        ) : null}
        {!loading && !loadError && kind === 'pull' ? (
          <>
            <div className="dialog-form-field">
              {targets.length ? (
                <label htmlFor="pull-remote-branch">{t('remoteBranch')}</label>
              ) : (
                <span>{t('remoteBranch')}</span>
              )}
              {targets.length ? (
                <div className="remote-operation-control-row">
                  <SelectControl
                    id="pull-remote-branch"
                    value={pullTarget}
                    disabled={locked}
                    data-dialog-initial-focus={!locked && !pullTarget ? true : undefined}
                    onChange={(event) => setPullTarget(event.currentTarget.value)}
                  >
                    <option value="">{t('selectRemoteBranch')}</option>
                    {targets.map((target) => (
                      <option key={target.label} value={target.label}>
                        {target.label}
                      </option>
                    ))}
                  </SelectControl>
                  <Button
                    type="button"
                    className="remote-operation-refresh-button"
                    aria-label={t('refreshBranches')}
                    aria-busy={refreshing}
                    title={t('refreshBranches')}
                    disabled={locked || !refreshRemote}
                    onClick={() => void refreshBranches()}
                  >
                    <RefreshCw aria-hidden="true" focusable="false" />
                  </Button>
                </div>
              ) : (
                <div className="remote-operation-empty-row">
                  <p>{t('noRemoteBranches')}</p>
                  <Button
                    type="button"
                    className="remote-operation-refresh-button"
                    aria-label={t('refreshBranches')}
                    aria-busy={refreshing}
                    title={t('refreshBranches')}
                    disabled={locked || !refreshRemote}
                    onClick={() => void refreshBranches()}
                  >
                    <RefreshCw aria-hidden="true" focusable="false" />
                  </Button>
                </div>
              )}
            </div>
            <label className="checkbox-field">
              <Input
                type="checkbox"
                checked={commitMergeImmediately}
                disabled={locked}
                onChange={(event) => setCommitMergeImmediately(event.currentTarget.checked)}
              />
              <span>{t('commitMergeImmediately')}</span>
            </label>
          </>
        ) : null}
        {!loading && !loadError && kind === 'push' ? (
          <>
            {remotes.length ? (
              <>
                <div className="dialog-form-field">
                  <label htmlFor="push-remote">{t('remote')}</label>
                  <div className="remote-operation-control-row">
                    <SelectControl
                      id="push-remote"
                      value={pushRemote}
                      disabled={locked}
                      onChange={(event) => {
                        const remote = event.currentTarget.value;
                        setPushRemote(remote);
                        setPushBranch(
                          upstreamTarget?.remote === remote
                            ? upstreamTarget.branch
                            : (repo.branch.name ?? ''),
                        );
                      }}
                    >
                      {remotes.map((remote) => (
                        <option key={remote.name} value={remote.name}>
                          {remote.name}
                        </option>
                      ))}
                    </SelectControl>
                    <Button
                      type="button"
                      className="remote-operation-refresh-button"
                      aria-label={t('refreshBranches')}
                      aria-busy={refreshing}
                      title={t('refreshBranches')}
                      disabled={locked || !refreshRemote}
                      onClick={() => void refreshBranches()}
                    >
                      <RefreshCw aria-hidden="true" focusable="false" />
                    </Button>
                  </div>
                </div>
                <label className="dialog-form-field">
                  <span>{t('remoteBranch')}</span>
                  <Input
                    list="push-remote-branches"
                    value={pushBranch}
                    disabled={locked}
                    onChange={(event) => setPushBranch(event.currentTarget.value)}
                  />
                  <datalist id="push-remote-branches">
                    {pushBranchSuggestions.map((target) => (
                      <option key={target.label} value={target.branch}>
                        {target.branch}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="checkbox-field">
                  <Input
                    type="checkbox"
                    checked={forceWithLease}
                    disabled={locked}
                    aria-describedby={forceWithLease ? 'force-with-lease-warning' : undefined}
                    onChange={(event) => setForceWithLease(event.currentTarget.checked)}
                  />
                  <span>{t('forceWithLease')}</span>
                </label>
                <label className="checkbox-field">
                  <Input
                    type="checkbox"
                    checked={pushTags}
                    disabled={locked}
                    onChange={(event) => setPushTags(event.currentTarget.checked)}
                  />
                  <span>{t('pushAllLocalTags')}</span>
                </label>
                {forceWithLease ? (
                  <p
                    id="force-with-lease-warning"
                    className="inline-alert warning"
                    aria-live="polite"
                  >
                    {t('forceWithLeaseWarning')}
                  </p>
                ) : null}
              </>
            ) : (
              <p>{t('noRemotes')}</p>
            )}
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={onDismiss}>
          {t(locked ? 'close' : 'cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          data-dialog-initial-focus={
            !locked &&
            !loading &&
            !loadError &&
            (kind === 'pull' ? Boolean(pullTarget) : Boolean(pushRemote && pushBranch.trim()))
              ? true
              : undefined
          }
          disabled={
            locked ||
            loading ||
            loadError ||
            (kind === 'pull' ? !pullTarget : !pushRemote || !pushBranch.trim())
          }
        >
          {t(kind)}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
