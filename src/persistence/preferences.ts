import type { ConventionalCommitInput, DiffStyle, WorkspaceView } from '../domain/workspace';
import { detectLanguage, isLanguage, type Language } from '../i18n/i18n';
import type { Appearance } from '../theme/appearance';

const STORAGE_KEY = 'stella.preferences.v1';
const STORAGE_VERSION = 1;
export const CHANGES_PANE_MIN_WIDTH = 240;

export interface PaneWidths {
  left: number;
  right: number;
}

export interface PaneWidthPreferences {
  changes: PaneWidths;
  history: { left: number };
  activity: { left: number };
}

export interface StellaPreferences {
  version: 1;
  appearance: Appearance;
  language: Language;
  diffStyle: DiffStyle;
  splitStageView: boolean;
  registeredRepoPaths: string[];
  repositoryNames: Record<string, string>;
  openRepoPaths: string[];
  selectedRepoPath?: string;
  view: WorkspaceView;
  paneWidths: PaneWidthPreferences;
  commitDrafts: Record<string, ConventionalCommitInput>;
}

export const DEFAULT_PREFERENCES: StellaPreferences = {
  version: STORAGE_VERSION,
  appearance: 'system',
  language: 'en',
  diffStyle: 'unified',
  splitStageView: true,
  registeredRepoPaths: [],
  repositoryNames: {},
  openRepoPaths: [],
  view: 'changes',
  paneWidths: {
    changes: { left: 320, right: 336 },
    history: { left: 244 },
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

function commitDraft(value: unknown): ConventionalCommitInput | undefined {
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

function commitDraftRecord(value: unknown): Record<string, ConventionalCommitInput> {
  if (!isRecord(value)) return {};
  const drafts: Record<string, ConventionalCommitInput> = {};
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

function boundedWidth(value: unknown, fallback: number, min = 180, max = 520): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
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
      diffStyle: isDiffStyle(value.diffStyle) ? value.diffStyle : DEFAULT_PREFERENCES.diffStyle,
      splitStageView:
        typeof value.splitStageView === 'boolean'
          ? value.splitStageView
          : DEFAULT_PREFERENCES.splitStageView,
      registeredRepoPaths: stringArray(value.registeredRepoPaths ?? value.recentRepoPaths),
      repositoryNames: repositoryNameRecord(value.repositoryNames),
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
