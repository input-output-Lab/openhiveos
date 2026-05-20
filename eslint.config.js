// @ts-check
import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  // Base TypeScript rules for all source files
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      ...tsPlugin.configs['strict-type-checked'].rules,
    },
  },
  // ARCH-003 / ARCH-005: Primitives must not import from Coordination Utilities.
  // Enforced via built-in no-restricted-imports — no external plugin dependency.
  {
    files: ['src/primitives/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/utilities/**', '../utilities/**', '../../utilities/**'],
              message:
                'OS Primitives cannot import from Coordination Utilities (ARCH-003). ' +
                'Primitives must be self-contained.',
            },
          ],
        },
      ],
    },
  },
]
