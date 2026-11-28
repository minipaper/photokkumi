import js from '@eslint/js'
import ts from 'typescript-eslint'
export default ts.config(
  { ignores: ['node_modules/**', 'out/**', 'release/**', 'test-results/**', 'playwright-report/**', '.claude/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
)
