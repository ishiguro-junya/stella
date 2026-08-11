import { createRoot } from 'react-dom/client';

import { AppRoot } from './AppRoot';
import { applyDocumentLanguage } from './i18n/i18n';
import { applyNativeLanguage } from './i18n/nativeLanguage';
import { readPreferences } from './persistence/preferences';
import { applyAppearance } from './theme/appearance';
import './styles.css';

if (import.meta.env.VITE_E2E === 'true') {
  void import('@wdio/tauri-plugin');
}

const root = document.getElementById('root');
if (!root) throw new Error('#root was not found');

const preferences = readPreferences();
applyAppearance(preferences.appearance);
applyDocumentLanguage(preferences.language);
void applyNativeLanguage(preferences.language).catch(() => undefined);

createRoot(root).render(<AppRoot />);
