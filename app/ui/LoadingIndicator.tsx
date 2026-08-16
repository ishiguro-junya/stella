import { LoaderCircle } from 'lucide-react';

import { useI18n } from '../i18n/i18n';

export function LoadingIndicator({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <output
      className={`loading-indicator${className ? ` ${className}` : ''}`}
      aria-label={t('loading')}
    >
      <LoaderCircle aria-hidden="true" focusable="false" />
    </output>
  );
}
