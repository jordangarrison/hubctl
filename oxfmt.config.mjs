import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

export default defineConfig({
  ...ultracite,
  printWidth: 120,
  semi: false,
  singleQuote: true,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    '**/*.json',
    '**/*.yaml',
    '**/*.yml',
    '**/*.md',
    'dist/**/*',
  ],
})
