import nextPlugin from '@next/eslint-plugin-next';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The conventions in CLAUDE.md, enforced rather than reviewed.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The engine may not reach for anything outside itself. The purity test in
    // packages/engine/tests asserts the same contract against the source text;
    // this catches it in the editor, before the test run.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'next', 'next/*', '@supabase/*', 'zod', 'node:*'],
              message:
                '@parkway/engine has zero runtime dependencies and imports no framework or Node built-in.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Time enters the engine as data, never from the clock.' },
        { name: 'crypto', message: 'Randomness enters the engine as a seed, never from crypto.' },
        { name: 'process', message: 'The engine reads no environment.' },
      ],
    },
  },
  {
    // Accessibility and hook correctness are acceptance criteria, not a later
    // polish pass, so the rules are in place before the first component exists.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // App Router only — this rule looks for a `pages/` directory that will
      // never exist and warns on every run when it does not find one.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    files: ['**/*.config.{ts,js,mjs}', '**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
  prettier,
);
