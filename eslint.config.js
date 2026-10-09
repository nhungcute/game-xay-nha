import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'map/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
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
