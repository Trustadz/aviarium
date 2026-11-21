import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version: appVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: { 'import.meta.env.VITE_AVIARIUM_VERSION': JSON.stringify(appVersion) },
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), {
    name: 'aviarium-offline',
    generateBundle(_, bundle) {
      const names = Object.keys(bundle).sort()
      function assets(roots: string[]) {
        const files = new Set<string>()
        function visit(name: string) {
          if (files.has(name) || !bundle[name]) return
          files.add(name)
          const chunk = bundle[name]
          if (chunk.type === 'chunk') {
            chunk.imports.forEach(visit)
            chunk.viteMetadata?.importedCss.forEach(visit)
            chunk.viteMetadata?.importedAssets.forEach(visit)
          }
        }
        roots.forEach(visit)
        return files
      }
      const shell = assets(names.filter(name => {
        const chunk = bundle[name]
        return chunk.type === 'chunk' && chunk.isEntry
      }))
      const gameAssets = Object.fromEntries(Object.entries({ sudoku: '/src/Player.tsx' }).map(([id, entry]) => {
        const files = assets(names.filter(name => {
          const chunk = bundle[name]
          return chunk.type === 'chunk' && chunk.facadeModuleId?.endsWith(entry)
        }))
        if (!files.size) throw new Error('Missing offline player assets for ' + id)
        return [id, [...files].filter(name => !shell.has(name)).map(name => '/' + name)]
      }))
      const source = readFileSync(new URL('./sw.txt', import.meta.url), 'utf8')
      const version = createHash('sha256').update(JSON.stringify(names) + source).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source
        .replace('__VERSION__', version)
        .replace('__GAME_ASSETS__', JSON.stringify(gameAssets))
        .replace('__SHELL_ASSETS__', JSON.stringify([...shell].map(name => '/' + name))) })
    },
  }],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4173' } },
})
