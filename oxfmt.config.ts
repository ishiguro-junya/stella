import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  jsxSingleQuote: false,
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  insertFinalNewline: true,
  ignorePatterns: ['**/*.md', '**/*.toml', 'target/**', 'dist/**', 'coverage/**', 'generated/**'],
});
