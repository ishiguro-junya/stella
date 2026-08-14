import 'i18next';

import type { defaultNS, resources } from './messages';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    enableSelector: false;
    resources: (typeof resources)['en'];
    returnNull: false;
    strictKeyChecks: true;
  }
}
