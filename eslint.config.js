import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config for the BrewMaster POS web app.
 *
 * This is the project's first real linter (the old `lint` script was just
 * `tsc --noEmit`). To keep the introduction non-disruptive on a codebase that
 * never had a linter, the noisiest rules (`no-explicit-any`, unused vars,
 * `react-hooks/exhaustive-deps`) are set to "warn" rather than "error" so CI
 * stays green while still surfacing the issues. Tighten to "error" over time.
 */
export default tseslint.config(
  {
    ignores: [
      'dist',
      'build',
      'coverage',
      'node_modules',
      '**/dist/**',
      'cloudflare-worker/node_modules',
      'scripts/**',
      '*.config.js',
      '*.config.ts',
    ],
  },

  // Application source — browser + React runtime.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Vitest unit tests — allow test globals via imports; relax any in fixtures.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Cloudflare Worker — service-worker runtime, its own tsconfig.
  {
    files: ['cloudflare-worker/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Disable stylistic rules that conflict with Prettier (must stay last).
  prettier
);
