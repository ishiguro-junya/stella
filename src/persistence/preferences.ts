import type {
  ConventionalCommitInput,
  DiffStyle,
  RepositoryHealthIssue,
  RemoteHealthReason,
  WorkspaceView,
} from '../domain/workspace';
import { detectLanguage, isLanguage, type Language } from '../i18n/i18n';
import type { Appearance } from '../theme/appearance';

const STORAGE_KEY = 'stella.preferences.v1';
const STORAGE_VERSION = 1;
export const CHANGES_PANE_MIN_WIDTH = 240;
export const EDITOR_WRAP_COLUMN_MIN = 40;
export const EDITOR_WRAP_COLUMN_MAX = 400;
export const DEFAULT_EDITOR_WRAP_COLUMN = 120;

export interface PaneWidths {
  left: number;
  right: number;
}

export interface PaneWidthPreferences {
  changes: PaneWidths;
  history: { left: number };
  activity: { left: number };
}

export interface CommitDraft {
  plainMessage: string;
  conventional: ConventionalCommitInput;
}

export interface StellaPreferences {
  version: 1;
  appearance: Appearance;
  language: Language;
  automaticUpdateChecks: boolean;
  diffStyle: DiffStyle;
  splitStageView: boolean;
  useConventionalCommits: boolean;
  stickyFileHeaders: boolean;
  editorLineWrapping: boolean;
  editorWrapColumn: number;
  registeredRepoPaths: string[];
  repositoryNames: Record<string, string>;
  repositoryHealthIssues: Record<string, RepositoryHealthIssue[]>;
  openRepoPaths: string[];
  selectedRepoPath?: string;
  view: WorkspaceView;
  paneWidths: PaneWidthPreferences;
  commitDrafts: Record<string, CommitDraft>;
}

export const DEFAULT_PREFERENCES: StellaPreferences = {
  version: STORAGE_VERSION,
  appearance: 'system',
  language: 'en',
  automaticUpdateChecks: true,
  diffStyle: 'unified',
  splitStageView: false,
  useConventionalCommits: false,
  stickyFileHeaders: false,
  editorLineWrapping: false,
  editorWrapColumn: DEFAULT_EDITOR_WRAP_COLUMN,
  registeredRepoPaths: [],
  repositoryNames: {},
  repositoryHealthIssues: {},
  openRepoPaths: [],
  view: 'changes',
  paneWidths: {
    changes: { left: 320, right: 336 },
    history: { left: 320 },
    activity: { left: 560 },
  },
  commitDrafts: {},
};

function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isView(value: unknown): value is WorkspaceView {
  return value === 'changes' || value === 'history';
}

function isDiffStyle(value: unknown): value is DiffStyle {
  return value === 'unified' || value === 'split';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function conventionalCommitDraft(value: unknown): ConventionalCommitInput | undefined {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.breaking !== 'boolean' ||
    typeof value.description !== 'string'
  ) {
    return undefined;
  }
  if (value.scope !== undefined && typeof value.scope !== 'string') return undefined;
  if (value.body !== undefined && typeof value.body !== 'string') return undefined;
  if (value.footer !== undefined && typeof value.footer !== 'string') return undefined;
  return {
    type: value.type,
    breaking: value.breaking,
    description: value.description,
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    ...(typeof value.footer === 'string' ? { footer: value.footer } : {}),
  };
}

function emptyConventionalCommitDraft(): ConventionalCommitInput {
  return { type: 'feat', scope: '', breaking: false, description: '', body: '', footer: '' };
}

function commitDraft(value: unknown): CommitDraft | undefined {
  const legacyDraft = conventionalCommitDraft(value);
  if (legacyDraft) return { plainMessage: '', conventional: legacyDraft };
  if (!isRecord(value)) return undefined;
  const conventional = conventionalCommitDraft(value.conventional);
  const plainMessage = typeof value.plainMessage === 'string' ? value.plainMessage : undefined;
  if (!conventional && plainMessage === undefined) return undefined;
  return {
    plainMessage: plainMessage ?? '',
    conventional: conventional ?? emptyConventionalCommitDraft(),
  };
}

function commitDraftRecord(value: unknown): Record<string, CommitDraft> {
  if (!isRecord(value)) return {};
  const drafts: Record<string, CommitDraft> = {};
  for (const [key, candidate] of Object.entries(value)) {
    const draft = commitDraft(candidate);
    if (draft) drafts[key] = draft;
  }
  return drafts;
}

function stringArray(value: unknown, limit?: number): string[] {
  const strings = Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : [];
  return limit === undefined ? strings : strings.slice(0, limit);
}

function repositoryNameRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([path, name]) => {
      if (typeof name !== 'string' || !name.trim()) return [];
      return [[path, name.trim()]];
    }),
  );
}

function repositoryHealthIssueRecord(value: unknown): Record<string, RepositoryHealthIssue[]> {
  if (!isRecord(value)) return {};
  const output: Record<string, RepositoryHealthIssue[]> = {};
  for (const [path, candidates] of Object.entries(value)) {
    if (!Array.isArray(candidates)) continue;
    const issues = candidates.flatMap((candidate): RepositoryHealthIssue[] => {
      if (!isRecord(candidate) || candidate.kind !== 'remote') return [];
      if (
        candidate.reason !== 'unavailable' &&
        candidate.reason !== 'authentication' &&
        candidate.reason !== 'network'
      )
        return [];
      if (typeof candidate.remote !== 'string' || !candidate.remote.trim()) return [];
      return [
        {
          kind: 'remote',
          reason: candidate.reason,
          remote: candidate.remote,
          ...(typeof candidate.failedAt === 'string' ? { failedAt: candidate.failedAt } : {}),
        },
      ];
    });
    if (issues.length) output[path] = issues;
  }
  return output;
}

function boundedWidth(value: unknown, fallback: number, min = 180, max = 520): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeEditorWrapColumn(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(EDITOR_WRAP_COLUMN_MAX, Math.max(EDITOR_WRAP_COLUMN_MIN, Math.round(value)))
    : DEFAULT_EDITOR_WRAP_COLUMN;
}

export function readPreferences(): StellaPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES, language: detectLanguage() };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      return DEFAULT_PREFERENCES;
    }
    const value = parsed;
    const paneWidths = isRecord(value.paneWidths) ? value.paneWidths : {};
    const changesPaneWidths = isRecord(paneWidths.changes) ? paneWidths.changes : {};
    const historyPaneWidths = isRecord(paneWidths.history) ? paneWidths.history : {};
    const activityPaneWidths = isRecord(paneWidths.activity) ? paneWidths.activity : {};
    return {
      version: STORAGE_VERSION,
      appearance: isAppearance(value.appearance)
        ? value.appearance
        : DEFAULT_PREFERENCES.appearance,
      language: isLanguage(value.language) ? value.language : detectLanguage(),
      automaticUpdateChecks:
        typeof value.automaticUpdateChecks === 'boolean'
          ? value.automaticUpdateChecks
          : DEFAULT_PREFERENCES.automaticUpdateChecks,
      diffStyle: isDiffStyle(value.diffStyle) ? value.diffStyle : DEFAULT_PREFERENCES.diffStyle,
      splitStageView:
        typeof value.splitStageView === 'boolean'
          ? value.splitStageView
          : DEFAULT_PREFERENCES.splitStageView,
      useConventionalCommits:
        typeof value.useConventionalCommits === 'boolean'
          ? value.useConventionalCommits
          : DEFAULT_PREFERENCES.useConventionalCommits,
      stickyFileHeaders:
        typeof value.stickyFileHeaders === 'boolean'
          ? value.stickyFileHeaders
          : DEFAULT_PREFERENCES.stickyFileHeaders,
      editorLineWrapping:
        typeof value.editorLineWrapping === 'boolean'
          ? value.editorLineWrapping
          : DEFAULT_PREFERENCES.editorLineWrapping,
      editorWrapColumn: normalizeEditorWrapColumn(value.editorWrapColumn),
      registeredRepoPaths: stringArray(value.registeredRepoPaths ?? value.recentRepoPaths),
      repositoryNames: repositoryNameRecord(value.repositoryNames),
      repositoryHealthIssues: repositoryHealthIssueRecord(value.repositoryHealthIssues),
      openRepoPaths: stringArray(value.openRepoPaths, 12),
      ...(typeof value.selectedRepoPath === 'string'
        ? { selectedRepoPath: value.selectedRepoPath }
        : {}),
      view: isView(value.view) ? value.view : DEFAULT_PREFERENCES.view,
      paneWidths: {
        changes: {
          left: boundedWidth(
            changesPaneWidths.left,
            DEFAULT_PREFERENCES.paneWidths.changes.left,
            CHANGES_PANE_MIN_WIDTH,
          ),
          right: boundedWidth(
            changesPaneWidths.right,
            DEFAULT_PREFERENCES.paneWidths.changes.right,
          ),
        },
        history: {
          left: boundedWidth(historyPaneWidths.left, DEFAULT_PREFERENCES.paneWidths.history.left),
        },
        activity: {
          left: boundedWidth(
            activityPaneWidths.left,
            DEFAULT_PREFERENCES.paneWidths.activity.left,
            360,
            600,
          ),
        },
      },
      commitDrafts: commitDraftRecord(value.commitDrafts),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(preferences: StellaPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // localStorageが満杯または利用不能でもGit操作は妨げない。
  }
}

export function updatePreferences(
  update: (current: StellaPreferences) => StellaPreferences,
): StellaPreferences {
  const next = update(readPreferences());
  writePreferences(next);
  return next;
}

export function rememberRepositoryPath(path: string, name?: string): StellaPreferences {
  return updatePreferences((current) => ({
    ...current,
    registeredRepoPaths: [
      path,
      ...current.registeredRepoPaths.filter((candidate) => candidate !== path),
    ],
    repositoryNames: name?.trim()
      ? { ...current.repositoryNames, [path]: name.trim() }
      : current.repositoryNames,
  }));
}

export function replaceRepositoryPath(oldPath: string, newPath: string): StellaPreferences {
  return updatePreferences((current) => {
    if (oldPath !== newPath && current.registeredRepoPaths.includes(newPath)) return current;
    const repositoryNames = { ...current.repositoryNames };
    const repositoryHealthIssues = { ...current.repositoryHealthIssues };
    const commitDrafts = { ...current.commitDrafts };
    if (repositoryNames[oldPath] !== undefined) {
      repositoryNames[newPath] = repositoryNames[oldPath];
      delete repositoryNames[oldPath];
    }
    if (repositoryHealthIssues[oldPath] !== undefined) {
      repositoryHealthIssues[newPath] = repositoryHealthIssues[oldPath];
      delete repositoryHealthIssues[oldPath];
    }
    if (commitDrafts[oldPath] !== undefined) {
      commitDrafts[newPath] = commitDrafts[oldPath];
      delete commitDrafts[oldPath];
    }
    return {
      ...current,
      registeredRepoPaths: current.registeredRepoPaths.map((path) =>
        path === oldPath ? newPath : path,
      ),
      repositoryNames,
      repositoryHealthIssues,
      openRepoPaths: current.openRepoPaths.map((path) => (path === oldPath ? newPath : path)),
      ...(current.selectedRepoPath === oldPath ? { selectedRepoPath: newPath } : {}),
      commitDrafts,
    };
  });
}

export function forgetRepositoryPath(path: string): StellaPreferences {
  return updatePreferences((current) => {
    const repositoryNames = { ...current.repositoryNames };
    const repositoryHealthIssues = { ...current.repositoryHealthIssues };
    const commitDrafts = { ...current.commitDrafts };
    delete repositoryNames[path];
    delete repositoryHealthIssues[path];
    delete commitDrafts[path];
    const withoutSelectedRepoPath = { ...current };
    delete withoutSelectedRepoPath.selectedRepoPath;
    return {
      ...(current.selectedRepoPath === path ? withoutSelectedRepoPath : current),
      registeredRepoPaths: current.registeredRepoPaths.filter((candidate) => candidate !== path),
      repositoryNames,
      repositoryHealthIssues,
      openRepoPaths: current.openRepoPaths.filter((candidate) => candidate !== path),
      commitDrafts,
    };
  });
}

export function recordRemoteHealthIssue(
  path: string,
  remote: string,
  reason: RemoteHealthReason,
): StellaPreferences {
  return updatePreferences((current) => ({
    ...current,
    repositoryHealthIssues: {
      ...current.repositoryHealthIssues,
      [path]: [
        ...(current.repositoryHealthIssues[path] ?? []).filter(
          (issue) => issue.kind !== 'remote' || issue.remote !== remote,
        ),
        { kind: 'remote', reason, remote, failedAt: new Date().toISOString() },
      ],
    },
  }));
}

export function clearRemoteHealthIssue(path: string, remote: string): StellaPreferences {
  return updatePreferences((current) => {
    const repositoryHealthIssues = { ...current.repositoryHealthIssues };
    const remaining = (repositoryHealthIssues[path] ?? []).filter(
      (issue) => issue.kind !== 'remote' || issue.remote !== remote,
    );
    if (remaining.length) repositoryHealthIssues[path] = remaining;
    else delete repositoryHealthIssues[path];
    return { ...current, repositoryHealthIssues };
  });
}
