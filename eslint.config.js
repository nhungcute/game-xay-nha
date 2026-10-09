import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '**/dist/**', 'map/**', 'node_modules/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  { files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'], languageOptions: { globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', fetch: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', indexedDB: 'readonly', crypto: 'readonly', ResizeObserver: 'readonly', HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', PointerEvent: 'readonly', WheelEvent: 'readonly', KeyboardEvent: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', location: 'readonly', matchMedia: 'readonly', devicePixelRatio: 'readonly', structuredClone: 'readonly' } } },
  // Playwright scripts: code inside page.evaluate() runs in the browser.
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { window: 'readonly', document: 'readonly' } } },
  {
    files: ['packages/sim/src/**/*.ts', 'packages/worldgen/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'three', 'three/*', 'react', 'react/*'] }],
      'no-restricted-globals': ['error', 'Date', 'window', 'document', 'process', 'Buffer', 'fetch', 'localStorage', 'performance', 'setTimeout', 'requestAnimationFrame'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use a seeded generator; sim time is supplied by its caller.' }],
    },
  },
);
