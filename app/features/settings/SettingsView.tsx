/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- 省略され得るパスをキーボード操作でも確認できるようにする。 */
import {
  Code2,
  FileDiff,
  GitBranch,
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '../../ui/Button';
import { DirectoryInput } from '../../ui/DirectoryInput';
import { Input } from '../../ui/Input';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import type { ToolchainMode, ToolchainStatus } from '../../adapters/toolchainAdapter';
import { isAbsoluteLocalPath } from '../../domain/repositoryLocation';
import type { DiffStyle } from '../../domain/workspace';
import { useI18n, type Language } from '../../i18n/i18n';
import {
  EDITOR_WRAP_COLUMN_MAX,
  EDITOR_WRAP_COLUMN_MIN,
  normalizeEditorWrapColumn,
  type DiffFileListDisplay,
} from '../../persistence/preferences';
import { APPEARANCE_OPTIONS, type Appearance } from '../../theme/appearance';
import {
  CODE_FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  UI_FONT_OPTIONS,
  isCodeFont,
  isFontSize,
  isUiFont,
  type CodeFont,
  type FontSize,
  type UiFont,
} from '../../theme/typography';
import { SelectControl } from '../../ui/SelectControl';
import { Tooltip } from '../../ui/Tooltip';

export interface SettingsViewProps {
  appearance: Appearance;
  language: Language;
  fontSize: FontSize;
  uiFont: UiFont;
  codeFont: CodeFont;
  automaticUpdateChecks: boolean;
  diffStyle: DiffStyle;
  imagePreviewLayout: DiffStyle;
  splitStageView: boolean;
  diffFileListDisplay: DiffFileListDisplay;
  repositoryBasePath: string;
  repositoryAccessNeedsAttention: boolean;
  useConventionalCommits: boolean;
  stickyFileHeaders: boolean;
  editorLineWrapping: boolean;
  editorWrapColumn: number;
  toolchainStatus?: ToolchainStatus;
  toolchainBusy?: boolean;
  onAppearanceChange: (appearance: Appearance) => void;
  onLanguageChange: (language: Language) => void;
  onFontSizeChange: (fontSize: FontSize) => void;
  onUiFontChange: (font: UiFont) => void;
  onCodeFontChange: (font: CodeFont) => void;
  onAutomaticUpdateChecksChange: (enabled: boolean) => void;
  onDiffStyleChange: (style: DiffStyle) => void;
  onImagePreviewLayoutChange: (style: DiffStyle) => void;
  onSplitStageViewChange: (split: boolean) => void;
  onDiffFileListDisplayChange: (display: DiffFileListDisplay) => void;
  onRepositoryBasePathChange: (path: string) => void;
  onChooseRepositoryBasePath: () => void;
  onOpenFilesAndFoldersSettings: () => void;
  onUseConventionalCommitsChange: (enabled: boolean) => void;
  onStickyFileHeadersChange: (sticky: boolean) => void;
  onEditorLineWrappingChange: (enabled: boolean) => void;
  onEditorWrapColumnChange: (column: number) => void;
  onResetPaneWidths: () => void;
  onIgnorePatternsChange: (patterns: string) => void;
  onToolchainModeChange: (mode: ToolchainMode) => void;
}

type SettingsCategory = 'general' | 'permissions' | 'appearance' | 'diff' | 'editor' | 'git';

function isLanguage(value: string): value is Language {
  return value === 'ja' || value === 'en';
}

function isAppearance(value: string): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isDiffStyle(value: string): value is DiffStyle {
  return value === 'unified' || value === 'split';
}

function isDiffFileListDisplay(value: string): value is DiffFileListDisplay {
  return value === 'nameAndPath' || value === 'fullPath' || value === 'tree';
}

function isToolchainMode(value: string): value is ToolchainMode {
  return value === 'bundled' || value === 'system';
}

export function SettingsView({
  appearance,
  language,
  fontSize,
  uiFont,
  codeFont,
  automaticUpdateChecks,
  diffStyle,
  imagePreviewLayout,
  splitStageView,
  diffFileListDisplay,
  repositoryBasePath,
  repositoryAccessNeedsAttention,
  useConventionalCommits,
  stickyFileHeaders,
  editorLineWrapping,
  editorWrapColumn,
  toolchainStatus,
  toolchainBusy = false,
  onAppearanceChange,
  onLanguageChange,
  onFontSizeChange,
  onUiFontChange,
  onCodeFontChange,
  onAutomaticUpdateChecksChange,
  onDiffStyleChange,
  onImagePreviewLayoutChange,
  onSplitStageViewChange,
  onDiffFileListDisplayChange,
  onRepositoryBasePathChange,
  onChooseRepositoryBasePath,
  onOpenFilesAndFoldersSettings,
  onUseConventionalCommitsChange,
  onStickyFileHeadersChange,
  onEditorLineWrappingChange,
  onEditorWrapColumnChange,
  onResetPaneWidths,
  onIgnorePatternsChange,
  onToolchainModeChange,
}: SettingsViewProps) {
  const { t } = useI18n();
  const categoryButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [category, setCategory] = useState<SettingsCategory>('general');
  const [wrapColumnDraft, setWrapColumnDraft] = useState(String(editorWrapColumn));
  const [repositoryBasePathDraft, setRepositoryBasePathDraft] = useState(repositoryBasePath);
  const [repositoryBasePathError, setRepositoryBasePathError] = useState(false);
  const [ignorePatternsDraft, setIgnorePatternsDraft] = useState(
    toolchainStatus?.ignorePatterns ?? '',
  );
  const categories = [
    { id: 'general', label: t('settingsCategoryGeneral'), Icon: SettingsIcon },
    { id: 'permissions', label: t('settingsCategoryPermissions'), Icon: ShieldCheck },
    { id: 'appearance', label: t('settingsCategoryAppearance'), Icon: Palette },
    { id: 'diff', label: t('settingsCategoryDiff'), Icon: FileDiff },
    { id: 'editor', label: t('settingsCategoryEditor'), Icon: Code2 },
    { id: 'git', label: t('settingsCategoryGit'), Icon: GitBranch },
  ] as const;
  const toolchainModeLabel = (mode: ToolchainMode): string =>
    t(mode === 'bundled' ? 'toolchainBundled' : 'toolchainSystem');

  useEffect(() => categoryButtonRefs.current[0]?.focus(), []);
  useEffect(() => setWrapColumnDraft(String(editorWrapColumn)), [editorWrapColumn]);
  useEffect(() => {
    setRepositoryBasePathDraft(repositoryBasePath);
    setRepositoryBasePathError(false);
  }, [repositoryBasePath]);
  useEffect(() => {
    if (toolchainStatus) setIgnorePatternsDraft(toolchainStatus.ignorePatterns);
  }, [toolchainStatus]);

  const commitWrapColumn = (): void => {
    const value = wrapColumnDraft.trim()
      ? normalizeEditorWrapColumn(Number(wrapColumnDraft))
      : editorWrapColumn;
    setWrapColumnDraft(String(value));
    onEditorWrapColumnChange(value);
  };

  const commitRepositoryBasePath = (draft = repositoryBasePathDraft): void => {
    const path = draft.trim();
    if (!isAbsoluteLocalPath(path)) {
      setRepositoryBasePathError(true);
      return;
    }
    setRepositoryBasePathDraft(path);
    setRepositoryBasePathError(false);
    onRepositoryBasePathChange(path);
  };

  const commitIgnorePatterns = (): void => {
    if (!toolchainStatus || ignorePatternsDraft === toolchainStatus.ignorePatterns) return;
    onIgnorePatternsChange(ignorePatternsDraft);
  };

  const moveCategory = (event: KeyboardEvent<HTMLButtonElement>, nextIndex: number): void => {
    const next = categories[nextIndex];
    if (!next) return;
    event.preventDefault();
    event.currentTarget
      .closest('.settings-category-navigation')
      ?.classList.add('is-keyboard-navigating');
    setCategory(next.id);
    categoryButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <main className="settings-view" aria-labelledby="settings-title">
      <div className="settings-content">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-body">
            <h1 id="settings-title">{t('settingsTitle')}</h1>
            <nav
              className="settings-category-navigation"
              aria-label={t('settingsCategories')}
              onPointerMove={(event) =>
                event.currentTarget.classList.remove('is-keyboard-navigating')
              }
            >
              {categories.map(({ id, label, Icon }, index) => (
                <Button
                  ref={(node) => {
                    categoryButtonRefs.current[index] = node;
                  }}
                  key={id}
                  type="button"
                  className="settings-category-button"
                  data-settings-category={id}
                  aria-controls={`settings-category-${id}`}
                  aria-current={category === id ? 'page' : undefined}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setCategory(id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown')
                      moveCategory(event, Math.min(index + 1, categories.length - 1));
                    else if (event.key === 'ArrowUp') moveCategory(event, Math.max(index - 1, 0));
                  }}
                >
                  <Icon aria-hidden="true" focusable="false" />
                  <span>{label}</span>
                </Button>
              ))}
            </nav>
          </div>
        </aside>

        <div className="settings-detail">
          <section
            id="settings-category-general"
            className="settings-category-panel"
            aria-labelledby="settings-category-general-title"
            hidden={category !== 'general'}
          >
            <h2 id="settings-category-general-title" className="settings-category-heading">
              {t('settingsCategoryGeneral')}
            </h2>
            <div className="settings-panel">
              <section className="settings-row" aria-labelledby="language-title">
                <div className="settings-row-copy">
                  <h3 id="language-title">{t('languageTitle')}</h3>
                  <p id="language-description">{t('languageDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="language"
                  value={language}
                  aria-labelledby="language-title"
                  aria-describedby="language-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isLanguage(value)) onLanguageChange(value);
                  }}
                >
                  {(['ja', 'en'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(option === 'ja' ? 'languageJapanese' : 'languageEnglish')}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="automatic-update-checks-title">
                <div className="settings-row-copy">
                  <h3 id="automatic-update-checks-title">{t('automaticUpdateChecksTitle')}</h3>
                  <p id="automatic-update-checks-description">
                    {t('automaticUpdateChecksDescription')}
                  </p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="automatic-update-checks"
                  value={automaticUpdateChecks ? 'enabled' : 'disabled'}
                  aria-labelledby="automatic-update-checks-title"
                  aria-describedby="automatic-update-checks-description"
                  onChange={(event) =>
                    onAutomaticUpdateChecksChange(event.currentTarget.value === 'enabled')
                  }
                >
                  <option value="enabled">{t('automaticUpdateChecksEnabled')}</option>
                  <option value="disabled">{t('automaticUpdateChecksDisabled')}</option>
                </SelectControl>
              </section>
            </div>
          </section>

          <section
            id="settings-category-permissions"
            className="settings-category-panel"
            aria-labelledby="settings-category-permissions-title"
            hidden={category !== 'permissions'}
          >
            <h2 id="settings-category-permissions-title" className="settings-category-heading">
              {t('settingsCategoryPermissions')}
            </h2>
            <div className="settings-panel">
              <section
                className="settings-row settings-wide-row settings-permission-row"
                aria-labelledby="repository-base-path-title"
              >
                <div className="settings-row-copy">
                  <h3 id="repository-base-path-title">{t('repositoryBasePathTitle')}</h3>
                  <p id="repository-base-path-description">{t('repositoryBasePathDescription')}</p>
                  {repositoryAccessNeedsAttention ? (
                    <p
                      id="files-and-folders-warning"
                      className="settings-permission-warning"
                      role="alert"
                    >
                      {t('filesAndFoldersPermissionNeedsAttention')}
                    </p>
                  ) : null}
                </div>
                <div className="settings-path-control">
                  <DirectoryInput
                    className="settings-path-input"
                    name="repository-base-path"
                    value={repositoryBasePathDraft}
                    aria-labelledby="repository-base-path-title"
                    aria-describedby={
                      repositoryBasePathError
                        ? 'repository-base-path-description repository-base-path-error'
                        : 'repository-base-path-description'
                    }
                    aria-invalid={repositoryBasePathError || undefined}
                    autoComplete="off"
                    pickerLabel={t('chooseRepositoryBasePath')}
                    onPick={onChooseRepositoryBasePath}
                    onChange={(event) => {
                      setRepositoryBasePathDraft(event.currentTarget.value);
                      setRepositoryBasePathError(false);
                    }}
                    onBlur={(event) => commitRepositoryBasePath(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                  {repositoryBasePathError ? (
                    <small id="repository-base-path-error" className="field-error" role="alert">
                      {t('invalidRepositoryPath')}
                    </small>
                  ) : null}
                </div>
                <div className="settings-permission-actions">
                  <Button
                    type="button"
                    aria-describedby={`repository-base-path-description${
                      repositoryAccessNeedsAttention ? ' files-and-folders-warning' : ''
                    }`}
                    onClick={onOpenFilesAndFoldersSettings}
                  >
                    {t('checkSystemSettings')}
                  </Button>
                </div>
              </section>
            </div>
          </section>

          <section
            id="settings-category-appearance"
            className="settings-category-panel"
            aria-labelledby="settings-category-appearance-title"
            hidden={category !== 'appearance'}
          >
            <h2 id="settings-category-appearance-title" className="settings-category-heading">
              {t('settingsCategoryAppearance')}
            </h2>
            <div className="settings-panel">
              <section className="settings-row" aria-labelledby="appearance-title">
                <div className="settings-row-copy">
                  <h3 id="appearance-title">{t('appearanceTitle')}</h3>
                  <p id="appearance-description">{t('appearanceDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="appearance"
                  value={appearance}
                  aria-labelledby="appearance-title"
                  aria-describedby="appearance-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isAppearance(value)) onAppearanceChange(value);
                  }}
                >
                  {APPEARANCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(
                        option === 'system'
                          ? 'appearanceSystem'
                          : option === 'light'
                            ? 'appearanceLight'
                            : 'appearanceDark',
                      )}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="font-size-title">
                <div className="settings-row-copy">
                  <h3 id="font-size-title">{t('fontSizeTitle')}</h3>
                  <p id="font-size-description">{t('fontSizeDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="font-size"
                  value={fontSize}
                  aria-labelledby="font-size-title"
                  aria-describedby="font-size-description"
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (isFontSize(value)) onFontSizeChange(value);
                  }}
                >
                  {FONT_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === 100 ? t('fontSizeDefault', { size: option }) : `${option}%`}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="ui-font-title">
                <div className="settings-row-copy">
                  <h3 id="ui-font-title">{t('uiFontTitle')}</h3>
                  <p id="ui-font-description">{t('uiFontDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="ui-font"
                  value={uiFont}
                  aria-labelledby="ui-font-title"
                  aria-describedby="ui-font-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isUiFont(value)) onUiFontChange(value);
                  }}
                >
                  {UI_FONT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(
                        option === 'system'
                          ? 'uiFontSystem'
                          : option === 'hiraginoSans'
                            ? 'uiFontHiraginoSans'
                            : option === 'helveticaNeue'
                              ? 'uiFontHelveticaNeue'
                              : 'uiFontAvenirNext',
                      )}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="code-font-title">
                <div className="settings-row-copy">
                  <h3 id="code-font-title">{t('codeFontTitle')}</h3>
                  <p id="code-font-description">{t('codeFontDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="code-font"
                  value={codeFont}
                  aria-labelledby="code-font-title"
                  aria-describedby="code-font-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isCodeFont(value)) onCodeFontChange(value);
                  }}
                >
                  {CODE_FONT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === 'sfMono' ? 'SF Mono' : option === 'menlo' ? 'Menlo' : 'Monaco'}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="pane-positions-title">
                <div className="settings-row-copy">
                  <h3 id="pane-positions-title">{t('panePositionsTitle')}</h3>
                  <p id="pane-positions-description">{t('panePositionsDescription')}</p>
                </div>
                <Button
                  type="button"
                  aria-describedby="pane-positions-description"
                  onClick={onResetPaneWidths}
                >
                  {t('resetPanePositions')}
                </Button>
              </section>
            </div>
          </section>

          <section
            id="settings-category-diff"
            className="settings-category-panel"
            aria-labelledby="settings-category-diff-title"
            hidden={category !== 'diff'}
          >
            <h2 id="settings-category-diff-title" className="settings-category-heading">
              {t('settingsCategoryDiff')}
            </h2>
            <div className="settings-panel">
              <section className="settings-row" aria-labelledby="stage-display-title">
                <div className="settings-row-copy">
                  <h3 id="stage-display-title">{t('stageDisplayTitle')}</h3>
                  <p id="stage-display-description">{t('stageDisplayDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="stage-display"
                  value={splitStageView ? 'show' : 'hide'}
                  aria-labelledby="stage-display-title"
                  aria-describedby="stage-display-description"
                  onChange={(event) => onSplitStageViewChange(event.currentTarget.value === 'show')}
                >
                  {([true, false] as const).map((option) => (
                    <option key={String(option)} value={option ? 'show' : 'hide'}>
                      {t(option ? 'stageDisplayShow' : 'stageDisplayHide')}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="diff-file-list-display-title">
                <div className="settings-row-copy">
                  <h3 id="diff-file-list-display-title">{t('diffFileListDisplayTitle')}</h3>
                  <p id="diff-file-list-display-description">
                    {t('diffFileListDisplayDescription')}
                  </p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="diff-file-list-display"
                  value={diffFileListDisplay}
                  aria-labelledby="diff-file-list-display-title"
                  aria-describedby="diff-file-list-display-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isDiffFileListDisplay(value)) onDiffFileListDisplayChange(value);
                  }}
                >
                  {(['nameAndPath', 'fullPath', 'tree'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(
                        option === 'nameAndPath'
                          ? 'diffFileListDisplayNameAndPath'
                          : option === 'fullPath'
                            ? 'diffFileListDisplayFullPath'
                            : 'diffFileListDisplayTree',
                      )}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="conventional-commits-title">
                <div className="settings-row-copy">
                  <h3 id="conventional-commits-title">{t('conventionalCommitsTitle')}</h3>
                  <p id="conventional-commits-description">{t('conventionalCommitsDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="conventional-commits"
                  value={useConventionalCommits ? 'enabled' : 'disabled'}
                  aria-labelledby="conventional-commits-title"
                  aria-describedby="conventional-commits-description"
                  onChange={(event) =>
                    onUseConventionalCommitsChange(event.currentTarget.value === 'enabled')
                  }
                >
                  {([false, true] as const).map((option) => (
                    <option key={String(option)} value={option ? 'enabled' : 'disabled'}>
                      {t(option ? 'conventionalCommitsEnabled' : 'conventionalCommitsDisabled')}
                    </option>
                  ))}
                </SelectControl>
              </section>
            </div>
          </section>

          <section
            id="settings-category-editor"
            className="settings-category-panel"
            aria-labelledby="settings-category-editor-title"
            hidden={category !== 'editor'}
          >
            <h2 id="settings-category-editor-title" className="settings-category-heading">
              {t('settingsCategoryEditor')}
            </h2>
            <div className="settings-panel">
              <section className="settings-row" aria-labelledby="diff-layout-title">
                <div className="settings-row-copy">
                  <h3 id="diff-layout-title">{t('diffLayout')}</h3>
                  <p id="diff-layout-description">{t('diffLayoutDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="diff-layout"
                  value={diffStyle}
                  aria-labelledby="diff-layout-title"
                  aria-describedby="diff-layout-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isDiffStyle(value)) onDiffStyleChange(value);
                  }}
                >
                  {(['unified', 'split'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(option)}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="image-preview-layout-title">
                <div className="settings-row-copy">
                  <h3 id="image-preview-layout-title">{t('imagePreviewLayout')}</h3>
                  <p id="image-preview-layout-description">{t('imagePreviewLayoutDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="image-preview-layout"
                  value={imagePreviewLayout}
                  aria-labelledby="image-preview-layout-title"
                  aria-describedby="image-preview-layout-description"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isDiffStyle(value)) onImagePreviewLayoutChange(value);
                  }}
                >
                  {(['unified', 'split'] as const).map((option) => (
                    <option key={option} value={option}>
                      {t(option)}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="sticky-file-headers-title">
                <div className="settings-row-copy">
                  <h3 id="sticky-file-headers-title">{t('stickyFileHeadersTitle')}</h3>
                  <p id="sticky-file-headers-description">{t('stickyFileHeadersDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="sticky-file-headers"
                  value={stickyFileHeaders ? 'enabled' : 'disabled'}
                  aria-labelledby="sticky-file-headers-title"
                  aria-describedby="sticky-file-headers-description"
                  onChange={(event) =>
                    onStickyFileHeadersChange(event.currentTarget.value === 'enabled')
                  }
                >
                  {([true, false] as const).map((option) => (
                    <option key={String(option)} value={option ? 'enabled' : 'disabled'}>
                      {t(option ? 'stickyFileHeadersEnabled' : 'stickyFileHeadersDisabled')}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="editor-line-wrapping-title">
                <div className="settings-row-copy">
                  <h3 id="editor-line-wrapping-title">{t('editorLineWrappingTitle')}</h3>
                  <p id="editor-line-wrapping-description">{t('editorLineWrappingDescription')}</p>
                </div>
                <SelectControl
                  className="settings-select"
                  name="editor-line-wrapping"
                  value={editorLineWrapping ? 'enabled' : 'disabled'}
                  aria-labelledby="editor-line-wrapping-title"
                  aria-describedby="editor-line-wrapping-description"
                  onChange={(event) =>
                    onEditorLineWrappingChange(event.currentTarget.value === 'enabled')
                  }
                >
                  {([true, false] as const).map((option) => (
                    <option key={String(option)} value={option ? 'enabled' : 'disabled'}>
                      {t(option ? 'editorLineWrappingEnabled' : 'editorLineWrappingDisabled')}
                    </option>
                  ))}
                </SelectControl>
              </section>

              <section className="settings-row" aria-labelledby="editor-wrap-column-title">
                <div className="settings-row-copy">
                  <h3 id="editor-wrap-column-title">{t('editorWrapColumnTitle')}</h3>
                  <p id="editor-wrap-column-description">{t('editorWrapColumnDescription')}</p>
                </div>
                <Input
                  className="settings-number-input"
                  name="editor-wrap-column"
                  type="number"
                  inputMode="numeric"
                  min={EDITOR_WRAP_COLUMN_MIN}
                  max={EDITOR_WRAP_COLUMN_MAX}
                  step={1}
                  value={wrapColumnDraft}
                  disabled={!editorLineWrapping}
                  aria-labelledby="editor-wrap-column-title"
                  aria-describedby="editor-wrap-column-description"
                  onChange={(event) => {
                    const draft = event.currentTarget.value;
                    setWrapColumnDraft(draft);
                    const value = Number(draft);
                    if (
                      Number.isInteger(value) &&
                      value >= EDITOR_WRAP_COLUMN_MIN &&
                      value <= EDITOR_WRAP_COLUMN_MAX
                    ) {
                      onEditorWrapColumnChange(value);
                    }
                  }}
                  onBlur={commitWrapColumn}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </section>
            </div>
          </section>

          <section
            id="settings-category-git"
            className="settings-category-panel"
            aria-labelledby="settings-category-git-title"
            hidden={category !== 'git'}
          >
            <h2 id="settings-category-git-title" className="settings-category-heading">
              {t('settingsCategoryGit')}
            </h2>
            <div className="settings-panel">
              <section
                className="settings-row settings-wide-row settings-ignore-patterns-row"
                aria-labelledby="ignore-patterns-title"
                aria-busy={!toolchainStatus || toolchainBusy}
              >
                <div className="settings-row-copy">
                  <h3 id="ignore-patterns-title">{t('ignorePatternsTitle')}</h3>
                  <p id="ignore-patterns-description">{t('ignorePatternsDescription')}</p>
                </div>
                <textarea
                  className="settings-ignore-patterns"
                  name="ignore-patterns"
                  value={ignorePatternsDraft}
                  disabled={!toolchainStatus || toolchainBusy}
                  aria-labelledby="ignore-patterns-title"
                  aria-describedby="ignore-patterns-description"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setIgnorePatternsDraft(event.currentTarget.value)}
                  onBlur={commitIgnorePatterns}
                />
              </section>
              <section
                className="settings-row settings-wide-row settings-toolchain-row"
                aria-labelledby="toolchain-title"
                aria-busy={!toolchainStatus || toolchainBusy}
              >
                <div className="settings-row-copy">
                  <h3 id="toolchain-title">{t('toolchainTitle')}</h3>
                  <p id="toolchain-description">{t('toolchainDescription')}</p>
                  {toolchainStatus?.restartRequired ? (
                    <output className="settings-restart-notice">
                      {t('toolchainRestartRequired')}
                    </output>
                  ) : null}
                </div>
                <div
                  className="settings-toolchain-control"
                  {...(toolchainStatus
                    ? {
                        'data-active-mode': toolchainStatus.activeMode,
                        'data-selected-mode': toolchainStatus.selectedMode,
                      }
                    : {})}
                >
                  <SelectControl
                    className="settings-select"
                    name="toolchain"
                    value={toolchainStatus?.selectedMode ?? 'bundled'}
                    aria-labelledby="toolchain-title"
                    aria-describedby="toolchain-description"
                    disabled={toolchainBusy || !toolchainStatus}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (isToolchainMode(value)) onToolchainModeChange(value);
                    }}
                  >
                    {(['bundled', 'system'] as const).map((option) => (
                      <option key={option} value={option}>
                        {toolchainModeLabel(option)}
                      </option>
                    ))}
                  </SelectControl>
                </div>
                {toolchainStatus ? (
                  <>
                    <dl className="settings-toolchain-modes">
                      <div>
                        <dt>{t('toolchainCurrentSession')}</dt>
                        <dd>{toolchainModeLabel(toolchainStatus.activeMode)}</dd>
                      </div>
                      <div>
                        <dt>{t('toolchainNextLaunch')}</dt>
                        <dd>{toolchainModeLabel(toolchainStatus.selectedMode)}</dd>
                      </div>
                    </dl>
                    <dl className="settings-toolchain-components">
                      {(
                        [
                          ['Git', toolchainStatus.git],
                          ['Git LFS', toolchainStatus.gitLfs],
                          ['Git Flow', toolchainStatus.gitFlow],
                        ] as const
                      ).map(([name, component]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd className={component.available ? undefined : 'is-unavailable'}>
                            {component.version ?? component.error ?? t('toolchainUnavailable')}
                            {component.path ? (
                              <Tooltip content={component.path}>
                                <code tabIndex={0}>{component.path}</code>
                              </Tooltip>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <LoadingIndicator className="settings-toolchain-loading" />
                )}
              </section>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
