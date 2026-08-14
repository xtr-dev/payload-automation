import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  cacheDir: rootDir + 'node_modules/.vite',
  test: {
    globals: true,
    environment: 'node',
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
