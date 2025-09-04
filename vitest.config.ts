import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    threads: false, // Prevent port/DB conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    testTimeout: 30000, // 30 second timeout for integration tests
    setupFiles: ['./dev/test-setup.ts']
  },
})