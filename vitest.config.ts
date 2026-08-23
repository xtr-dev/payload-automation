import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: 'node_modules/.vite/vitest',
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
