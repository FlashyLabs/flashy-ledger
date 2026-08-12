import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Numbers in template literals are idiomatic and safe; the rule's default
      // objection is to objects and nullables, which stay banned.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The ledger's whole point is that its rules do not depend on I/O. Anything
    // that reaches for a clock, a random source or the network belongs in an
    // adapter, where it can be substituted in a test.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The domain is pure. Pass occurredAt in from the caller.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'The domain must be deterministic.' },
        { object: 'Date', property: 'now', message: 'The domain is pure. Pass occurredAt in.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Test doubles implement async ports without awaiting anything.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
    },
  },
)
