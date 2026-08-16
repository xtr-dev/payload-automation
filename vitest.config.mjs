import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  cacheDir: path.resolve(dirname, 'node_modules/.vite'),
  test: {
    include: ['tests/int/**/*.int.spec.ts', 'tests/unit/**/*.spec.ts'],
    hookTimeout: 60000,
    testTimeout: 60000,
    // @payloadcms/drizzle caches the last-pushed schema at module scope and
    // skips repushing it when unchanged - fine for one dev server, wrong
    // here since every test spins up a fresh, empty sqlite file against the
    // same collection schema. Force the push every time.
    env: {
      PAYLOAD_FORCE_DRIZZLE_PUSH: 'true',
    },
  },
})
