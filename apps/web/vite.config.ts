import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), {
    name: 'aviarium-offline',
    generateBundle(_, bundle) {
      const names = Object.keys(bundle).sort()
      const manifest = names.filter(name => name.endsWith('.css') || name.endsWith('.js') && !/\/(Studio|Admin)-/.test(name))
      const source = readFileSync(new URL('./sw.txt', import.meta.url), 'utf8')
      const version = createHash('sha256').update(JSON.stringify(names) + source).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source
        .replace('__VERSION__', version).replace('__PLAYER_ASSETS__', JSON.stringify(manifest.map(name => '/' + name)))
        .replace('__SHELL_ASSETS__', JSON.stringify(manifest.filter(name => !/\/(Player|solver)-/.test(name)).map(name => '/' + name))) })
    },
  }],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4173' } },
})
