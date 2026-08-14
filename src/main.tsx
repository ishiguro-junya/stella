import { createRoot } from 'react-dom/client';

import { AppRoot } from './AppRoot';
import { applyDocumentLanguage } from './i18n/i18n';
import { applyNativeLanguage } from './i18n/nativeLanguage';
import { readPreferences, setDevelopmentRepository } from './persistence/preferences';
import { applyAppearance } from './theme/appearance';
import { applyTypography } from './theme/typography';
import './styles.css';

if (import.meta.env.VITE_E2E === 'true') {
  void import('@wdio/tauri-plugin');
}

const developmentRepositoryPath = import.meta.env.VITE_DEV_REPOSITORY_PATH;
if (
  import.meta.env.DEV &&
  developmentRepositoryPath &&
  sessionStorage.getItem('stella.dev-repository.v1') !== developmentRepositoryPath
) {
  setDevelopmentRepository(developmentRepositoryPath);
  sessionStorage.setItem('stella.dev-repository.v1', developmentRepositoryPath);
}

const root = document.getElementById('root');
if (!root) throw new Error('#root was not found');

const preferences = readPreferences();
applyAppearance(preferences.appearance);
applyTypography(preferences.fontSize, preferences.uiFont, preferences.codeFont);
applyDocumentLanguage(preferences.language);
void applyNativeLanguage(preferences.language).catch(() => undefined);

createRoot(root).render(<AppRoot />);
