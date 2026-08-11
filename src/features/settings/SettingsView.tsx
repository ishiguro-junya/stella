import type { ToolchainMode, ToolchainStatus } from '../../adapters/toolchainAdapter';
import type { DiffStyle } from '../../domain/workspace';
import { useI18n, type Language } from '../../i18n/i18n';
import { APPEARANCE_OPTIONS, type Appearance } from '../../theme/appearance';
import { SelectControl } from '../../ui/SelectControl';

export interface SettingsViewProps {
  appearance: Appearance;
  language: Language;
  diffStyle: DiffStyle;
  splitStageView: boolean;
  toolchainStatus?: ToolchainStatus;
  toolchainBusy?: boolean;
  onAppearanceChange: (appearance: Appearance) => void;
  onLanguageChange: (language: Language) => void;
  onDiffStyleChange: (style: DiffStyle) => void;
  onSplitStageViewChange: (split: boolean) => void;
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
  diffStyle,
  splitStageView,
  toolchainStatus,
  toolchainBusy = false,
  onAppearanceChange,
  onLanguageChange,
  onDiffStyleChange,
  onSplitStageViewChange,
  onToolchainModeChange,
}: SettingsViewProps) {
  const { t } = useI18n();
  const toolchainModeLabel = (mode: ToolchainMode): string =>
    t(mode === 'bundled' ? 'toolchainBundled' : 'toolchainSystem');

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
              value={splitStageView ? 'split' : 'combined'}
              aria-labelledby="stage-display-title"
              aria-describedby="stage-display-description"
              onChange={(event) => onSplitStageViewChange(event.currentTarget.value === 'split')}
            >
              {([true, false] as const).map((option) => (
                <option key={String(option)} value={option ? 'split' : 'combined'}>
                  {t(option ? 'stageDisplaySplit' : 'stageDisplayCombined')}
                </option>
              ))}
            </SelectControl>
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
              {toolchainStatus ? (
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
              ) : null}
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
                      {component.path ? <code title={component.path}>{component.path}</code> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="settings-toolchain-loading">{t('loading')}</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
