import { useEffect, useState } from 'react';

import type { ToolchainMode, ToolchainStatus } from '../../adapters/toolchainAdapter';
import type { DiffStyle } from '../../domain/workspace';
import { useI18n, type Language } from '../../i18n/i18n';
import {
  EDITOR_WRAP_COLUMN_MAX,
  EDITOR_WRAP_COLUMN_MIN,
  normalizeEditorWrapColumn,
} from '../../persistence/preferences';
import { APPEARANCE_OPTIONS, type Appearance } from '../../theme/appearance';
import { SelectControl } from '../../ui/SelectControl';

export interface SettingsViewProps {
  appearance: Appearance;
  language: Language;
  automaticUpdateChecks: boolean;
  diffStyle: DiffStyle;
  splitStageView: boolean;
  useConventionalCommits: boolean;
  stickyFileHeaders: boolean;
  editorLineWrapping: boolean;
  editorWrapColumn: number;
  toolchainStatus?: ToolchainStatus;
  toolchainBusy?: boolean;
  onAppearanceChange: (appearance: Appearance) => void;
  onLanguageChange: (language: Language) => void;
  onAutomaticUpdateChecksChange: (enabled: boolean) => void;
  onDiffStyleChange: (style: DiffStyle) => void;
  onSplitStageViewChange: (split: boolean) => void;
  onUseConventionalCommitsChange: (enabled: boolean) => void;
  onStickyFileHeadersChange: (sticky: boolean) => void;
  onEditorLineWrappingChange: (enabled: boolean) => void;
  onEditorWrapColumnChange: (column: number) => void;
  onToolchainModeChange: (mode: ToolchainMode) => void;
}

function isLanguage(value: string): value is Language {
  return value === 'ja' || value === 'en';
}

function isAppearance(value: string): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isDiffStyle(value: string): value is DiffStyle {
  return value === 'unified' || value === 'split';
}

function isToolchainMode(value: string): value is ToolchainMode {
  return value === 'bundled' || value === 'system';
}

export function SettingsView({
  appearance,
  language,
  automaticUpdateChecks,
  diffStyle,
  splitStageView,
  useConventionalCommits,
  stickyFileHeaders,
  editorLineWrapping,
  editorWrapColumn,
  toolchainStatus,
  toolchainBusy = false,
  onAppearanceChange,
  onLanguageChange,
  onAutomaticUpdateChecksChange,
  onDiffStyleChange,
  onSplitStageViewChange,
  onUseConventionalCommitsChange,
  onStickyFileHeadersChange,
  onEditorLineWrappingChange,
  onEditorWrapColumnChange,
  onToolchainModeChange,
}: SettingsViewProps) {
  const { t } = useI18n();
  const [wrapColumnDraft, setWrapColumnDraft] = useState(String(editorWrapColumn));
  const toolchainModeLabel = (mode: ToolchainMode): string =>
    t(mode === 'bundled' ? 'toolchainBundled' : 'toolchainSystem');

  useEffect(() => setWrapColumnDraft(String(editorWrapColumn)), [editorWrapColumn]);

  const commitWrapColumn = (): void => {
    const value = wrapColumnDraft.trim()
      ? normalizeEditorWrapColumn(Number(wrapColumnDraft))
      : editorWrapColumn;
    setWrapColumnDraft(String(value));
    onEditorWrapColumnChange(value);
  };

  return (
    <main className="settings-view" aria-labelledby="settings-title">
      <h1 id="settings-title" className="sr-only">
        {t('settingsTitle')}
      </h1>
      <div className="settings-content">
        <div className="settings-panel">
          <section className="settings-row" aria-labelledby="language-title">
            <div className="settings-row-copy">
              <h2 id="language-title">{t('languageTitle')}</h2>
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

          <section className="settings-row" aria-labelledby="appearance-title">
            <div className="settings-row-copy">
              <h2 id="appearance-title">{t('appearanceTitle')}</h2>
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

          <section className="settings-row" aria-labelledby="automatic-update-checks-title">
            <div className="settings-row-copy">
              <h2 id="automatic-update-checks-title">{t('automaticUpdateChecksTitle')}</h2>
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

          <section className="settings-row" aria-labelledby="diff-layout-title">
            <div className="settings-row-copy">
              <h2 id="diff-layout-title">{t('diffLayout')}</h2>
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

          <section className="settings-row" aria-labelledby="stage-display-title">
            <div className="settings-row-copy">
              <h2 id="stage-display-title">{t('stageDisplayTitle')}</h2>
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

          <section className="settings-row" aria-labelledby="conventional-commits-title">
            <div className="settings-row-copy">
              <h2 id="conventional-commits-title">{t('conventionalCommitsTitle')}</h2>
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

          <section className="settings-row" aria-labelledby="sticky-file-headers-title">
            <div className="settings-row-copy">
              <h2 id="sticky-file-headers-title">{t('stickyFileHeadersTitle')}</h2>
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
              <h2 id="editor-line-wrapping-title">{t('editorLineWrappingTitle')}</h2>
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
              <h2 id="editor-wrap-column-title">{t('editorWrapColumnTitle')}</h2>
              <p id="editor-wrap-column-description">{t('editorWrapColumnDescription')}</p>
            </div>
            <input
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

          <section
            className="settings-row settings-toolchain-row"
            aria-labelledby="toolchain-title"
          >
            <div className="settings-row-copy">
              <h2 id="toolchain-title">{t('toolchainTitle')}</h2>
              <p id="toolchain-description">{t('toolchainDescription')}</p>
              {toolchainStatus?.restartRequired ? (
                <output className="settings-restart-notice">{t('toolchainRestartRequired')}</output>
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
                          <code title={component.path}>{component.path}</code>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="settings-toolchain-loading">{t('loading')}</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
