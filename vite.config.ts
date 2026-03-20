import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Connect } from 'vite'
import fs from 'node:fs'

// Serve pre-compressed .wasm.gz files for .wasm requests
function servePrecompressedWasm(): { name: string; configureServer: (server: { middlewares: Connect.Server }) => void } {
  return {
    name: 'serve-precompressed-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('.wasm')) {
          const gzPath = `./public${req.url}.gz`
          if (fs.existsSync(gzPath)) {
            res.setHeader('Content-Type', 'application/wasm')
            res.setHeader('Content-Encoding', 'gzip')
            fs.createReadStream(gzPath).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), servePrecompressedWasm()],
})
