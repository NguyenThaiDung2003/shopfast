// ESLint flat config dùng chung cho toàn monorepo.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.{js,cjs}',
      // Bản export Google Stitch – chỉ là tài liệu tham chiếu.
      'apps/web/design/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    // Script CLI (seed, đo hiệu năng) được phép in ra console.
    files: ['apps/api/prisma/**/*.ts', 'apps/api/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Test và helper test không đi qua Fast Refresh.
    files: ['apps/web/src/**/*.test.{ts,tsx}', 'apps/web/src/test/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  prettier,
);
