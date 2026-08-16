import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-font-size');
  document.documentElement.removeAttribute('data-ui-font');
  document.documentElement.removeAttribute('data-code-font');
  document.documentElement.removeAttribute('lang');
});
