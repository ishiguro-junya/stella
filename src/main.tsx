import { createRoot } from 'react-dom/client';

import { AppRoot } from './AppRoot';
import { applyDocumentLanguage } from './i18n/i18n';
import { applyNativeLanguage } from './i18n/nativeLanguage';
import { readPreferences, setDevelopmentRepositories } from './persistence/preferences';
import { applyAppearance } from './theme/appearance';
import { applyTypography } from './theme/typography';
import './styles.css';

if (import.meta.env.VITE_E2E === 'true') {
  void import('@wdio/tauri-plugin');
}

const developmentRepositoryPaths = (() => {
  try {
    const value: unknown = JSON.parse(import.meta.env.VITE_DEV_REPOSITORY_PATHS ?? '[]');
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string')
      : [];
  } catch {
    return [];
  }
})();
const developmentRepositoriesKey = developmentRepositoryPaths.join('\n');
if (
  import.meta.env.DEV &&
  developmentRepositoryPaths.length > 0 &&
  sessionStorage.getItem('stella.dev-repositories.v1') !== developmentRepositoriesKey
) {
  setDevelopmentRepositories(developmentRepositoryPaths);
  sessionStorage.setItem('stella.dev-repositories.v1', developmentRepositoriesKey);
}

const root = document.getElementById('root');
if (!root) throw new Error('#root was not found');

const preferences = readPreferences();
applyAppearance(preferences.appearance);
applyTypography(preferences.fontSize, preferences.uiFont, preferences.codeFont);
applyDocumentLanguage(preferences.language);
void applyNativeLanguage(preferences.language).catch(() => undefined);

createRoot(root).render(<AppRoot />);
