import { defineConfig } from 'vitest/config'

// A repo-local config is required even though it only sets defaults: without one,
// Vite's config search walks up to the workspace root and picks up
// ../../vitest.config.mjs (wandel-private's own suite config), which then tries
// to write its cache outside this worktree and fails with EROFS.
export default defineConfig({
  cacheDir: 'node_modules/.vite',
  test: {
    include: ['src/**/*.test.ts'],
  },
})
