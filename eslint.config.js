import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // These paths contain generated output, disposable diagnostics, or local
  // reference clones. They are not part of the application lint boundary.
  globalIgnores(['dist/**', 'docmost/**', 'notesnook/**', 'tmp/**', 'sw.js']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // The main rule set defaults to browser globals for React. Add Node's
    // runtime globals for server code, scripts, tests, and tool configuration.
    files: ['api/**/*.js', 'e2e/**/*.js', 'scripts/**/*.js', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
