import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Connect } from 'vite'
import { cpSync, existsSync, createReadStream } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

// Copy Nutrient SDK assets to public/ so they're served statically.
// NOTE: Copying from node_modules is deprecated for released versions (use the
// self-host ZIP instead). We use it here because nightly builds don't publish
// a separate assets archive. The deprecation warning in the console is expected.
const sdkAssetsSrc = path.resolve(
  __dirname,
  'node_modules/@nutrient-sdk/viewer/dist/nutrient-viewer-lib',
)
const sdkAssetsDest = path.resolve(__dirname, 'public/nutrient-viewer-lib')
cpSync(sdkAssetsSrc, sdkAssetsDest, { recursive: true, force: true })

// Pre-compress .wasm files for serving with gzip
const wasmFiles = execSync(`find ${sdkAssetsDest} -name "*.wasm" -type f`).toString().trim().split('\n').filter(Boolean)
for (const wasmFile of wasmFiles) {
  if (!existsSync(`${wasmFile}.gz`)) {
    execSync(`gzip -k "${wasmFile}"`)
  }
}

// Serve pre-compressed .wasm.gz files for .wasm requests
function servePrecompressedWasm(): { name: string; configureServer: (server: { middlewares: Connect.Server }) => void } {
  return {
    name: 'serve-precompressed-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('.wasm')) {
          const gzPath = `./public${req.url}.gz`
          if (existsSync(gzPath)) {
            res.setHeader('Content-Type', 'application/wasm')
            res.setHeader('Content-Encoding', 'gzip')
            createReadStream(gzPath).pipe(res)
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
