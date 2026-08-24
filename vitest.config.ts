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
    // 'tests/**' holds the integration suite; 'src/test/*.test.ts' holds the
    // package-exports contract tests that read dist/ (they live under src/
    // because their subject is the published output of src/index.ts).
    include: ['tests/**/*.test.ts', 'tests/**/*.int.spec.ts', 'src/test/*.test.ts'],
    hookTimeout: 60000,
    testTimeout: 60000,
    // @payloadcms/drizzle caches the last-pushed schema at module scope and
    // skips repushing it when unchanged. Every integration test here spins up
    // a fresh empty sqlite file against the same collection schema, so force
    // the push every time.
    env: {
      PAYLOAD_FORCE_DRIZZLE_PUSH: 'true',
    },
    typecheck: {
      enabled: true,
      include: ['src/test/**/*.test-d.ts'],
      // The base tsconfig excludes src/test so its .ts files don't ship as
      // .d.ts in dist/ (see build:swc's matching --ignore) - but that same
      // exclude, if reused here, would make tsc silently skip *.test-d.ts
      // entirely and report every assertion as passing regardless of truth.
      tsconfig: './tsconfig.typecheck.json',
      // src/plugin/index.ts has a pre-existing, unrelated TS2769 (tracked
      // separately) that would otherwise fail every typecheck run
      // regardless of what these type-level tests actually assert.
      ignoreSourceErrors: true,
    },
  },
})
