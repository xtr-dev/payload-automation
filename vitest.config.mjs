/** @type {import('vitest/config').UserConfig} */
export default {
  cacheDir: 'node_modules/.vite/vitest',
  test: {
    include: ['src/**/*.test.ts'],
  },
}
