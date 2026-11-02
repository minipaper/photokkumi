import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 45_000, reporter: 'list',
  projects: [
    { name: 'native' },
    { name: 'scale-1', grep: /실제 마우스 이동/, metadata: { deviceScaleFactor: 1 } },
    { name: 'scale-2', grep: /실제 마우스 이동/, metadata: { deviceScaleFactor: 2 } }
  ]
})
