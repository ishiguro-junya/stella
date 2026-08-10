import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setTheme } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';

export const APPEARANCE_OPTIONS = ['system', 'light', 'dark'] as const;

export type Appearance = (typeof APPEARANCE_OPTIONS)[number];

const AppearanceContext = createContext<Appearance>('system');

export function applyAppearance(appearance: Appearance): void {
  if (appearance === 'system') {
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  document.documentElement.dataset.theme = appearance;
}

export async function applyNativeAppearance(appearance: Appearance): Promise<void> {
  if (!isTauri()) return;
  try {
    await setTheme(appearance === 'system' ? null : appearance);
  } catch {
    // native window themeの反映失敗でWebViewやGit操作を妨げない。
  }
}

export function AppearanceProvider({
  appearance,
  children,
}: {
  appearance: Appearance;
  children: ReactNode;
}) {
  return <AppearanceContext value={appearance}>{children}</AppearanceContext>;
}

export function useAppearance(): Appearance {
  return useContext(AppearanceContext);
}

function systemAppearance(): Exclude<Appearance, 'system'> {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function useResolvedAppearance(): Exclude<Appearance, 'system'> {
  const appearance = useAppearance();
  const [system, setSystem] = useState(systemAppearance);

  useEffect(() => {
    if (appearance !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystem(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [appearance]);

  return appearance === 'system' ? system : appearance;
}
