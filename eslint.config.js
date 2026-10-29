import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
export default [
  { files: ['tests/e2e/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.cache/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { react, 'react-hooks': hooks },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
