import effect from '@mpsuesser/oxlint-plugin-effect'
import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'
import vitest from 'ultracite/oxlint/vitest'

// Single-package config (no monorepo workspaces). The Effect idiom plugin is
// registered via jsPlugins; the layer-boundaries plugin is added in the
// implementation phase once src/{cli,services,github,output,schema} exist.
export default defineConfig({
  extends: [core, vitest],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist/**/*', 'node_modules/**/*', '**/*.d.ts'],
  jsPlugins: [
    {
      name: 'effect',
      specifier: '@mpsuesser/oxlint-plugin-effect',
    },
  ],
  overrides: [
    {
      files: ['**/services/**/*.ts'],
      rules: {
        'unicorn/filename-case': 'off',
      },
    },
    {
      files: ['**/*.{test,spec}.ts', '**/test/**/*.ts'],
      plugins: ['vitest'],
      rules: {
        // @effect/vitest's `layer(L)(name, (it) => ...)` shadows module-level `it`.
        'no-shadow': ['error', { allow: ['it'] }],
        'vitest/no-standalone-expect': 'off',
        'vitest/prefer-importing-vitest-globals': 'off',
        'vitest/max-expects': ['error', { max: 20 }],
        // Idiom rules target production code, not test scaffolding.
        'effect/imperative-loops': 'off',
        'effect/avoid-process-env': 'off',
        'effect/avoid-native-object-helpers': 'off',
      },
    },
  ],
  rules: {
    ...effect.configs.recommended.rules,
    'no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'no-param-reassign': 'error',
    'prefer-as-const': 'error',
    'default-param-last': 'error',
    // Stylistic opt-outs that fight Effect or repo conventions.
    'sort-keys': 'off',
    'func-names': 'off',
    '@typescript-eslint/array-type': 'off',
    'no-negated-condition': 'off',
    'unicorn/no-negated-condition': 'off',
    'max-classes-per-file': 'off',
    'unicorn/no-array-for-each': 'off',
    // These broad `.length`/Schema idiom rules create churn without clear wins.
    'effect/prefer-arr-match': 'off',
    'effect/no-length-comparison': 'off',
    'effect/prefer-schema-class': 'off',
  },
})
