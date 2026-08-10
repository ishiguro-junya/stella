import { type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';

import { useI18n, type Language } from '../../i18n/i18n';
import { APPEARANCE_OPTIONS, type Appearance } from '../../theme/appearance';

export interface SettingsViewProps {
  appearance: Appearance;
  language: Language;
  onAppearanceChange: (appearance: Appearance) => void;
  onLanguageChange: (language: Language) => void;
}

function handleSegmentedKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
  const direction =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  if (direction === 0) return;

  const options = Array.from(
    event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    ) ?? [],
  );
  const currentIndex = options.indexOf(event.currentTarget);
  if (currentIndex < 0 || options.length === 0) return;

  event.preventDefault();
  const next = options[(currentIndex + direction + options.length) % options.length];
  if (!next) return;
  next.click();
  next.focus();
}

export function SettingsView({
  appearance,
  language,
  onAppearanceChange,
  onLanguageChange,
}: SettingsViewProps) {
  const { t } = useI18n();

  return (
    <main className="settings-view" aria-labelledby="settings-title">
      <h1 id="settings-title" className="sr-only">
        {t('settingsTitle')}
      </h1>
      <div className="settings-content">
        <div className="settings-panel">
          <section className="settings-row" aria-labelledby="appearance-title">
            <div className="settings-row-copy">
              <h2 id="appearance-title">{t('appearanceTitle')}</h2>
              <p id="appearance-description">{t('appearanceDescription')}</p>
            </div>
            <fieldset
              className="settings-segmented settings-appearance-options"
              aria-describedby="appearance-description"
            >
              <legend className="sr-only">{t('appearanceTitle')}</legend>
              {APPEARANCE_OPTIONS.map((option) => {
                const Icon = option === 'system' ? Laptop : option === 'light' ? Sun : Moon;
                return (
                  <label key={option} className="settings-segmented-option">
                    <input
                      type="radio"
                      name="appearance"
                      value={option}
                      checked={appearance === option}
                      onChange={() => onAppearanceChange(option)}
                      onKeyDown={handleSegmentedKeyDown}
                    />
                    <Icon aria-hidden="true" focusable="false" />
                    <span>
                      {t(
                        option === 'system'
                          ? 'appearanceSystem'
                          : option === 'light'
                            ? 'appearanceLight'
                            : 'appearanceDark',
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </section>

          <section className="settings-row" aria-labelledby="language-title">
            <div className="settings-row-copy">
              <h2 id="language-title">{t('languageTitle')}</h2>
              <p id="language-description">{t('languageDescription')}</p>
            </div>
            <fieldset
              className="settings-segmented settings-language-options"
              aria-describedby="language-description"
            >
              <legend className="sr-only">{t('languageTitle')}</legend>
              {(['ja', 'en'] as const).map((option) => (
                <label key={option} className="settings-segmented-option">
                  <input
                    type="radio"
                    name="language"
                    value={option}
                    checked={language === option}
                    onChange={() => onLanguageChange(option)}
                    onKeyDown={handleSegmentedKeyDown}
                  />
                  <span>{t(option === 'ja' ? 'languageJapanese' : 'languageEnglish')}</span>
                </label>
              ))}
            </fieldset>
          </section>
        </div>
      </div>
    </main>
  );
}
