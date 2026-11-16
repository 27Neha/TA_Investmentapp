// Flat ESLint config (ESLint 9). Deliberately lenient at first: existing code is not reformatted or
// mass-rewritten; `no-explicit-any` and unused vars are warnings to be ratcheted down in later milestones.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**', '**/build/**', '**/coverage/**',
      'apps/api/prisma/migrations/**', 'apps/mobile/web-build/**', '**/*.tsbuildinfo', '**/next-env.d.ts', '**/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  { files: ['apps/api/**/*.ts', 'apps/api/**/*.js', 'apps/mobile/scripts/**', '**/*.mjs', '**/*.cjs'], languageOptions: { globals: globals.node } },
  {
    files: ['apps/mobile/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { files: ['**/*.js'], languageOptions: { globals: globals.node, sourceType: 'commonjs' } },
  prettier,
);
