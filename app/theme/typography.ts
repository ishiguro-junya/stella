export const FONT_SIZE_OPTIONS = [80, 90, 100, 110, 120] as const;
export const UI_FONT_OPTIONS = ['system', 'hiraginoSans', 'helveticaNeue', 'avenirNext'] as const;
export const CODE_FONT_OPTIONS = ['sfMono', 'menlo', 'monaco'] as const;

export type FontSize = (typeof FONT_SIZE_OPTIONS)[number];
export type UiFont = (typeof UI_FONT_OPTIONS)[number];
export type CodeFont = (typeof CODE_FONT_OPTIONS)[number];

export function isFontSize(value: unknown): value is FontSize {
  return FONT_SIZE_OPTIONS.some((option) => option === value);
}

export function isUiFont(value: unknown): value is UiFont {
  return UI_FONT_OPTIONS.some((option) => option === value);
}

export function isCodeFont(value: unknown): value is CodeFont {
  return CODE_FONT_OPTIONS.some((option) => option === value);
}

export function applyTypography(fontSize: FontSize, uiFont: UiFont, codeFont: CodeFont): void {
  document.documentElement.dataset.fontSize = String(fontSize);
  document.documentElement.dataset.uiFont = uiFont;
  document.documentElement.dataset.codeFont = codeFont;
}
