import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: js.configs.recommended.rules,
  },
  {
    files: ['vite.config.js', 'eslint.config.js', 'tests/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: js.configs.recommended.rules,
  },
]
