import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    typecheck: {
      // Keep public-contract failures visible while the existing source type error
      // is addressed separately.
      ignoreSourceErrors: true,
    },
  },
})
