import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '.wrangler/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.js', 'hosts/*'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.worker, HTMLRewriter: 'readonly' } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  { files: ['admin/app.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['scripts/**/*.js', 'test/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  { files: ['tests/e2e/**/*.js'], languageOptions: { globals: globals.browser } },
];
