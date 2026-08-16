/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
  readonly VITE_DEV_REPOSITORY_PATHS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  stellaE2eDirectoryPickerResult?: string | null;
}
