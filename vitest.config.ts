import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Keep the cache inside this package. A bare `vitest` otherwise walks up to
  // a workspace-level config and tries to write node_modules/.vite-temp there.
  cacheDir: path.resolve(dirname, 'node_modules/.vite'),
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.int.spec.ts'],
    hookTimeout: 60000,
    testTimeout: 60000,
    // @payloadcms/drizzle caches the last-pushed schema at module scope and
    // skips repushing it when unchanged. Every integration test here spins up
    // a fresh empty sqlite file against the same collection schema, so force
    // the push every time.
    env: {
      PAYLOAD_FORCE_DRIZZLE_PUSH: 'true',
    },
  },
})
