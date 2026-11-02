import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { plugins: [react(), {
    name: 'local-csp',
    transformIndexHtml(html, context) {
      const script = context.server ? "'self' 'unsafe-inline'" : "'self'"
      const connect = context.server ? "'self' ws://localhost:* ws://127.0.0.1:*" : "'none'"
      return html.replace('__CSP__', `default-src 'none'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-src 'none'`)
    }
  }] }
})
